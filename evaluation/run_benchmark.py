#!/usr/bin/env python3
"""Reproducible YAMNet / ESC-50 benchmark for VigilGrace.

What this measures (and nothing more):

  Task A  Infant-cry detection, zero-shot. Positive class = ESC-50
          ``crying_baby`` (40 clips); negative class = the other 49 ESC-50
          categories. This is a *distress-adjacent* class that ESC-50 actually
          labels — it is NOT adult screaming, violence, or "a person in danger".

  Task B  Scream-alarm false-positive audit. YAMNet's ``Screaming`` and
          ``Shout`` scores are run over every non-cry ESC-50 clip and the
          false-positive rate is reported per category, at fixed thresholds.
          ESC-50 contains no scream recordings, so *recall for screams cannot be
          measured here*. This task only measures how often everyday sounds
          would trigger a scream alarm.

  Task C  Baseline comparison. The shipped heuristic in
          ``src/core/voice/acoustic-analyzer.ts`` is re-implemented line for line
          and scored on the same clips, so the model is compared against the
          thing it would replace — not against nothing.

  Task D  Synthetic white-noise robustness at 10 dB and 5 dB SNR.

  Task E  Desktop CPU latency per 0.975 s window. This is a lower bound for
          phone latency, not a phone measurement.

Usage:
    python3 run_benchmark.py --data-dir /tmp/vg-ai/data --out results
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import platform
import statistics
import sys
import time
import zlib
import wave
from dataclasses import dataclass, field

import numpy as np
from scipy.signal import resample_poly

SAMPLE_RATE = 16000
WINDOW_SAMPLES = 15600  # YAMNet classification TFLite: 0.975 s @ 16 kHz
HOP_SAMPLES = 7800  # 50 % overlap, matches the SavedModel patch hop

# YAMNet class indices from yamnet_class_map.csv (index,mid,display_name).
CLASS_SHOUT = 6
CLASS_SCREAMING = 11
CLASS_CRYING = 19
CLASS_BABY_CRY = 20

# Presets copied from ACOUSTIC_PRESETS in src/core/voice/acoustic-analyzer.ts.
BASELINE_PRESETS = {
    "low": {"burstThresholdDb": -18.0, "minBurstMs": 350, "minConfidence": 0.65},
    "medium": {"burstThresholdDb": -24.0, "minBurstMs": 250, "minConfidence": 0.55},
    "high": {"burstThresholdDb": -30.0, "minBurstMs": 150, "minConfidence": 0.45},
}
BASELINE_COOLDOWN_MS = 10000
BASELINE_CHUNK_MS = 100  # assumed AudioStream buffer size; documented limitation


# --------------------------------------------------------------------------- #
# Audio I/O
# --------------------------------------------------------------------------- #
def read_wav_16k(path: str) -> np.ndarray:
    with wave.open(path, "rb") as handle:
        if handle.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit PCM")
        channels = handle.getnchannels()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    data = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE:
        # 44100 -> 16000 is exactly 160/441.
        data = resample_poly(data, SAMPLE_RATE, rate).astype(np.float32)
    return np.clip(data, -1.0, 1.0)


def windows(signal: np.ndarray) -> np.ndarray:
    batch = []
    for start in range(0, max(1, len(signal)), HOP_SAMPLES):
        chunk = signal[start : start + WINDOW_SAMPLES]
        if len(chunk) < WINDOW_SAMPLES:
            chunk = np.pad(chunk, (0, WINDOW_SAMPLES - len(chunk)))
        batch.append(chunk.astype(np.float32))
        if start + WINDOW_SAMPLES >= len(signal):
            break
    return np.stack(batch) if batch else np.zeros((1, WINDOW_SAMPLES), dtype=np.float32)


# --------------------------------------------------------------------------- #
# Shipped heuristic, mirrored from src/core/voice/acoustic-analyzer.ts
# --------------------------------------------------------------------------- #
@dataclass
class BaselineAnalyzer:
    burst_threshold_db: float
    min_burst_ms: float
    min_confidence: float
    cooldown_ms: float = BASELINE_COOLDOWN_MS
    burst_ms: float = 0.0
    last_event_at: float = float("-inf")

    def feed(self, chunk: np.ndarray, t_ms: float) -> bool:
        n = len(chunk)
        sum_sq = float(np.dot(chunk, chunk))
        rms = float(np.sqrt(sum_sq / n)) if n else 0.0
        dbfs = 20 * np.log10(min(1.0, rms)) if rms > 0 else -100.0
        signs = chunk >= 0
        crossings = int(np.count_nonzero(signs[1:] != signs[:-1]))
        zcr = crossings / (n - 1) if n > 1 else 0.0
        window_ms = n / SAMPLE_RATE * 1000

        if dbfs >= self.burst_threshold_db:
            self.burst_ms += window_ms
        else:
            self.burst_ms = max(0.0, self.burst_ms - window_ms * 1.5)

        if self.burst_ms < self.min_burst_ms or t_ms - self.last_event_at < self.cooldown_ms:
            return False

        voiced = dbfs >= -45 and 0.01 <= zcr <= 0.25
        exceedance = (dbfs - self.burst_threshold_db) / 12
        level_score = max(0.0, min(1.0, exceedance))
        raw = level_score * (1.0 if voiced else 0.55)
        confidence = round(min(1.0, raw + (0.15 if voiced else 0.0)), 2)
        if confidence < self.min_confidence:
            return False
        self.last_event_at = t_ms
        self.burst_ms = 0.0
        return True


def baseline_alarm(clip: np.ndarray, preset: str) -> bool:
    cfg = BASELINE_PRESETS[preset]
    analyzer = BaselineAnalyzer(
        burst_threshold_db=cfg["burstThresholdDb"],
        min_burst_ms=cfg["minBurstMs"],
        min_confidence=cfg["minConfidence"],
    )
    step = int(SAMPLE_RATE * BASELINE_CHUNK_MS / 1000)
    fired = False
    for index, start in enumerate(range(0, len(clip) - step + 1, step)):
        fired = analyzer.feed(clip[start : start + step], index * BASELINE_CHUNK_MS) or fired
    return fired


# --------------------------------------------------------------------------- #
# YAMNet
# --------------------------------------------------------------------------- #
class Yamnet:
    def __init__(self, model_path: str, threads: int = 2):
        import tensorflow as tf  # imported lazily so --help works without TF

        self.interpreter = tf.lite.Interpreter(model_path=model_path, num_threads=threads)
        self.interpreter.allocate_tensors()
        self.input_detail = self.interpreter.get_input_details()[0]
        self.output_detail = self.interpreter.get_output_details()[0]

    def scores(self, batch: np.ndarray) -> np.ndarray:
        out = np.zeros((len(batch), 521), dtype=np.float32)
        for i, window in enumerate(batch):
            # The classification TFLite takes a rank-1 waveform: [15600] float32.
            self.interpreter.set_tensor(self.input_detail["index"], window.astype(np.float32))
            self.interpreter.invoke()
            out[i] = self.interpreter.get_tensor(self.output_detail["index"])[0]
        return out


def add_noise(clip: np.ndarray, snr_db: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noise = rng.normal(size=len(clip)).astype(np.float32)
    signal_rms = float(np.sqrt(np.mean(clip**2))) or 1e-6
    noise_rms = float(np.sqrt(np.mean(noise**2)))
    target_noise_rms = signal_rms / (10 ** (snr_db / 20))
    mixed = clip + noise * (target_noise_rms / noise_rms)
    peak = float(np.max(np.abs(mixed)))
    return (mixed / peak * 0.99).astype(np.float32) if peak > 1 else mixed.astype(np.float32)


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #
def alarm(scores: np.ndarray, threshold: float) -> np.ndarray:
    """Alarm decision for one clip.

    A clip alarms when any analysed window scored at or above the threshold.
    Named and separate so the thresholding rule itself is unit-tested
    (see evaluation/test_metrics.py).
    """
    return (scores >= threshold).astype(int)


def binary_metrics(labels: np.ndarray, preds: np.ndarray) -> dict:
    tp = int(np.sum((labels == 1) & (preds == 1)))
    fn = int(np.sum((labels == 1) & (preds == 0)))
    fp = int(np.sum((labels == 0) & (preds == 1)))
    tn = int(np.sum((labels == 0) & (preds == 0)))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    fpr = fp / (fp + tn) if fp + tn else 0.0
    return {
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "false_positive_rate": round(fpr, 4),
        "specificity": round(1 - fpr, 4),
        "accuracy": round((tp + tn) / len(labels), 4),
        "confusion_matrix": {"tp": tp, "fn": fn, "fp": fp, "tn": tn},
    }


def wilson_interval(successes: int, total: int, z: float = 1.96) -> list[float]:
    if total == 0:
        return [0.0, 0.0]
    p = successes / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    margin = z * np.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return [round(max(0.0, centre - margin), 4), round(min(1.0, centre + margin), 4)]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="evaluation/data")
    parser.add_argument("--out", default="evaluation/results")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--max-clips", type=int, default=0, help="0 = all clips in the manifest")
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(data_dir, "manifest.json"), encoding="utf-8") as handle:
        manifest = json.load(handle)
    clips = manifest["clips"]
    if args.max_clips:
        clips = clips[: args.max_clips]
    if not clips:
        raise SystemExit("no clips in manifest; run fetch_assets.py first")

    model = Yamnet(os.path.join(data_dir, "yamnet_classification.tflite"), args.threads)
    signal_cache: dict[str, np.ndarray] = {}
    for entry in clips:
        signal_cache[entry["filename"]] = read_wav_16k(os.path.join(data_dir, "audio", entry["filename"]))

    print(f"clips: {len(clips)}  categories: {len({c['category'] for c in clips})}")

    # --- per-clip model scores ------------------------------------------------
    per_clip: list[dict] = []
    for index, entry in enumerate(clips, start=1):
        signal = signal_cache[entry["filename"]]
        batch = windows(signal)
        scores = model.scores(batch)
        per_clip.append({
            "filename": entry["filename"],
            "category": entry["category"],
            "fold": entry["fold"],
            "windows": int(len(batch)),
            "baby_cry": float(scores[:, CLASS_BABY_CRY].max()),
            "crying": float(scores[:, CLASS_CRYING].max()),
            "screaming": float(scores[:, CLASS_SCREAMING].max()),
            "shout": float(scores[:, CLASS_SHOUT].max()),
            "baseline_medium": baseline_alarm(signal, "medium"),
            "baseline_high": baseline_alarm(signal, "high"),
            "baseline_low": baseline_alarm(signal, "low"),
        })
        if index % 200 == 0:
            print(f"  scored {index}/{len(clips)}")

    labels = np.array([1 if c["category"] == "crying_baby" else 0 for c in per_clip])
    cry_score = np.array([c["baby_cry"] for c in per_clip])
    scream_score = np.array([c["screaming"] for c in per_clip])
    shout_score = np.array([c["shout"] for c in per_clip])

    results: dict = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "environment": {
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "platform": platform.platform(),
            "machine": platform.machine(),
        },
        "assets": manifest["checksums"],
        "dataset": {
            "name": "ESC-50",
            "license": "CC BY-NC 3.0 (audio, not redistributed)",
            "clips": len(per_clip),
            "categories": len({c["category"] for c in per_clip}),
            "manifest_sha256": manifest["manifest_sha256"],
            "class_balance": {
                "crying_baby": int(labels.sum()),
                "other": int((labels == 0).sum()),
            },
        },
    }

    # --- Task A: zero-shot infant cry ----------------------------------------
    sweep = []
    for threshold in [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]:
        metrics = binary_metrics(labels, alarm(cry_score, threshold))
        metrics["threshold"] = threshold
        sweep.append(metrics)
    chosen = 0.5
    task_a = binary_metrics(labels, alarm(cry_score, chosen))
    task_a["threshold"] = chosen
    task_a["recall_ci95"] = wilson_interval(task_a["tp"], task_a["tp"] + task_a["fn"])
    task_a["fpr_ci95"] = wilson_interval(task_a["fp"], task_a["fp"] + task_a["tn"])
    results["task_a_infant_cry"] = {
        "positive_class": "ESC-50 crying_baby (infant crying)",
        "negative_class": "49 other ESC-50 categories",
        "at_threshold": task_a,
        "sweep": sweep,
        "baseline_comparison": {
            "medium": binary_metrics(labels, np.array([1 if c["baseline_medium"] else 0 for c in per_clip])),
            "high": binary_metrics(labels, np.array([1 if c["baseline_high"] else 0 for c in per_clip])),
            "low": binary_metrics(labels, np.array([1 if c["baseline_low"] else 0 for c in per_clip])),
        },
        "per_fold": {},
    }
    for fold in sorted({c["fold"] for c in per_clip}):
        mask = np.array([c["fold"] == fold for c in per_clip])
        results["task_a_infant_cry"]["per_fold"][str(fold)] = binary_metrics(
            labels[mask], alarm(cry_score[mask], chosen)
        )

    # --- Task B: scream-alarm false positives --------------------------------
    healthy = labels == 0
    by_category: dict[str, dict] = {}
    for category in sorted({c["category"] for c in per_clip if c["category"] != "crying_baby"}):
        mask = np.array([c["category"] == category for c in per_clip])
        by_category[category] = {
            "clips": int(mask.sum()),
            "screaming_fpr@0.5": round(float(np.mean(alarm(scream_score[mask], 0.5))), 4),
            "screaming_fpr@0.7": round(float(np.mean(scream_score[mask] >= 0.7)), 4),
            "max_screaming": round(float(scream_score[mask].max()), 4),
            "max_shout": round(float(shout_score[mask].max()), 4),
        }
    results["task_b_scream_alarm"] = {
        "note": (
            "ESC-50 contains no screams, so recall for screams is NOT measurable. "
            "These numbers are false-positive rates on everyday sounds."
        ),
        "negatives": int(healthy.sum()),
        "screaming": {
            f"fpr@{t}": round(float(np.mean(scream_score[healthy] >= t)), 4) for t in (0.3, 0.5, 0.7, 0.9)
        },
        "shout": {
            f"fpr@{t}": round(float(np.mean(shout_score[healthy] >= t)), 4) for t in (0.3, 0.5, 0.7, 0.9)
        },
        "either_scream_or_shout@0.5": round(
            float(np.mean((scream_score[healthy] >= 0.5) | (shout_score[healthy] >= 0.5))), 4
        ),
        "either_scream_or_shout@0.7": round(
            float(np.mean((scream_score[healthy] >= 0.7) | (shout_score[healthy] >= 0.7))), 4
        ),
        "by_category": by_category,
        "baseline_alarm_rate": {
            preset: round(float(np.mean([c[f"baseline_{preset}"] for c in per_clip if c["category"] != "crying_baby"])), 4)
            for preset in ("low", "medium", "high")
        },
    }

    # --- Task C: baseline vs model on the cry task already included above ----

    # --- Task D: synthetic noise robustness ----------------------------------
    stratified = [c for c in per_clip if c["category"] == "crying_baby"] + [
        c for c in per_clip if c["category"] != "crying_baby"
    ][:: max(1, len(per_clip) // 120)]
    noise_results = {}
    for snr in (10, 5):
        rows = []
        for entry in stratified:
            # Stable seed across runs: Python's hash() is salted per process.
            noisy = add_noise(
                signal_cache[entry["filename"]], snr, seed=zlib.crc32(entry["filename"].encode())
            )
            score = float(model.scores(windows(noisy))[:, CLASS_BABY_CRY].max())
            rows.append((entry["category"] == "crying_baby", score))
        y = np.array([1 if r[0] else 0 for r in rows])
        s = np.array([r[1] for r in rows])
        noise_results[f"snr_{snr}db"] = binary_metrics(y, alarm(s, chosen))
    results["task_d_noise"] = {
        "note": "synthetic additive white noise, not recorded babble/traffic; SNR set relative to clip RMS",
        "subset_size": len(stratified),
        "results": noise_results,
    }

    # --- Task E: latency ------------------------------------------------------
    probe = windows(signal_cache[per_clip[0]["filename"]])[:20]
    for _ in range(3):  # warm-up
        model.scores(probe[:1])
    timings = []
    for window in probe:
        start = time.perf_counter()
        model.scores(window[None, :])
        timings.append((time.perf_counter() - start) * 1000)
    results["task_e_latency"] = {
        "machine": platform.machine(),
        "model_bytes": os.path.getsize(os.path.join(data_dir, "yamnet_classification.tflite")),
        "per_window_ms": {
            "median": round(statistics.median(timings), 2),
            "p95": round(float(np.percentile(timings, 95)), 2),
            "max": round(max(timings), 2),
        },
        "note": "desktop CPU with XNNPACK; phone latency was not measured",
    }

    with open(os.path.join(out_dir, "per_clip.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(per_clip[0].keys()))
        writer.writeheader()
        writer.writerows(per_clip)
    with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2, sort_keys=True)

    print(json.dumps(
        {
            "task_a": {k: task_a[k] for k in ("precision", "recall", "f1", "false_positive_rate", "tp", "fp", "tn", "fn")},
            "baseline_medium": results["task_a_infant_cry"]["baseline_comparison"]["medium"],
            "task_b": results["task_b_scream_alarm"]["screaming"],
            "task_e": results["task_e_latency"]["per_window_ms"],
        },
        indent=2,
    ))
    print(f"\nwrote {out_dir}/results.json and per_clip.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
