#!/usr/bin/env python3
"""Fetch the evaluation assets for the VigilGrace audio study.

Downloads (and checksum-verifies) exactly three public artefacts:

  1. YAMNet quantised TFLite classifier  — Apache-2.0, Google/TensorFlow.
  2. YAMNet class map CSV                — Apache-2.0 repo, AudioSet labels CC BY-SA 4.0.
  3. ESC-50 metadata CSV                 — CC BY-NC 3.0 (audio is NOT redistributed here).

ESC-50 audio clips are downloaded one by one into a local data directory that is
git-ignored. They are CC BY-NC 3.0: usable for this non-commercial benchmark,
NOT for redistribution and NOT for training a shipped model.

Nothing is written inside the repository unless you point --data-dir there.
Usage:
    python3 fetch_assets.py --data-dir /tmp/vg-ai/data
    python3 fetch_assets.py --data-dir /tmp/vg-ai/data --limit-per-class 2  # smoke test
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

MODEL_URL = "https://tfhub.dev/google/lite-model/yamnet/classification/tflite/1?lite-format=tflite"
CLASS_MAP_URL = (
    "https://raw.githubusercontent.com/tensorflow/models/master/"
    "research/audioset/yamnet/yamnet_class_map.csv"
)
ESC50_META_URL = "https://raw.githubusercontent.com/karolpiczak/ESC-50/master/meta/esc50.csv"
ESC50_AUDIO_URL = "https://raw.githubusercontent.com/karolpiczak/ESC-50/master/audio/{name}"

EXPECTED_SHA256 = {
    "yamnet_classification.tflite": "10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de",
    "yamnet_class_map.csv": "cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2",
    "esc50.csv": "ca660da60191a97de289983a05821c9382d852a38a2ba8428980816b68cf6246",
}

UA = {"User-Agent": "VigilGrace-eval/1.0 (research benchmark)"}


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: str, retries: int = 5, timeout: int = 120) -> None:
    """Download with resume-free retries; verifies HTTP status, not just bytes."""
    tmp = dest + ".part"
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status} for {url}")
                with open(tmp, "wb") as out:
                    while True:
                        chunk = response.read(1 << 16)
                        if not chunk:
                            break
                        out.write(chunk)
            if os.path.getsize(tmp) == 0:
                raise RuntimeError(f"empty body for {url}")
            os.replace(tmp, dest)
            return
        except (urllib.error.URLError, RuntimeError, TimeoutError, OSError) as exc:
            if attempt == retries:
                raise
            wait = min(20, 2 ** attempt)
            print(f"  retry {attempt}/{retries} in {wait}s: {url} ({exc})", file=sys.stderr)
            time.sleep(wait)


def download_checked(url: str, dest: str, expected: str | None) -> str:
    if os.path.exists(dest) and expected and sha256_file(dest) == expected:
        print(f"  cached {os.path.basename(dest)}")
        return expected
    download(url, dest)
    actual = sha256_file(dest)
    if expected and actual != expected:
        os.remove(dest)
        raise SystemExit(
            f"checksum mismatch for {dest}: expected {expected}, got {actual}. "
            "Refusing to benchmark against an unverified artefact."
        )
    print(f"  fetched {os.path.basename(dest)} sha256={actual}")
    return actual


def load_meta(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="evaluation/data")
    parser.add_argument(
        "--limit-per-class",
        type=int,
        default=0,
        help="Download at most N clips per ESC-50 category (0 = all 40).",
    )
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    audio_dir = os.path.join(data_dir, "audio")
    os.makedirs(audio_dir, exist_ok=True)

    print(f"data dir: {data_dir}")
    checksums = {}
    checksums["yamnet_classification.tflite"] = download_checked(
        MODEL_URL,
        os.path.join(data_dir, "yamnet_classification.tflite"),
        EXPECTED_SHA256["yamnet_classification.tflite"],
    )
    checksums["yamnet_class_map.csv"] = download_checked(
        CLASS_MAP_URL,
        os.path.join(data_dir, "yamnet_class_map.csv"),
        EXPECTED_SHA256["yamnet_class_map.csv"],
    )
    checksums["esc50.csv"] = download_checked(
        ESC50_META_URL,
        os.path.join(data_dir, "esc50.csv"),
        EXPECTED_SHA256["esc50.csv"],
    )

    rows = load_meta(os.path.join(data_dir, "esc50.csv"))
    per_class: dict[str, int] = {}
    selected: list[dict[str, str]] = []
    for row in sorted(rows, key=lambda r: (r["category"], r["filename"])):
        category = row["category"]
        count = per_class.get(category, 0)
        if args.limit_per_class and count >= args.limit_per_class:
            continue
        per_class[category] = count + 1
        selected.append(row)

    print(f"ESC-50 clips selected: {len(selected)} across {len(per_class)} categories")

    def fetch_clip(row: dict[str, str]) -> tuple[str, bool]:
        dest = os.path.join(audio_dir, row["filename"])
        if os.path.exists(dest) and os.path.getsize(dest) > 1024:
            return row["filename"], True
        download(ESC50_AUDIO_URL.format(name=row["filename"]), dest, retries=6)
        return row["filename"], False

    started = time.time()
    failures: list[str] = []
    fresh = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_clip, row): row for row in selected}
        for done, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            name = futures[future]["filename"]
            try:
                _, cached = future.result()
                fresh += 0 if cached else 1
            except Exception as exc:  # noqa: BLE001 - reported, not swallowed
                failures.append(f"{name}: {exc}")
            if done % 100 == 0 or done == len(selected):
                elapsed = time.time() - started
                print(f"  {done}/{len(selected)} clips ({elapsed:.0f}s, {fresh} new)")

    manifest = {
        "dataset": "ESC-50",
        "dataset_url": "https://github.com/karolpiczak/ESC-50",
        "license": "CC BY-NC 3.0 (audio), see NOTICE.md",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "checksums": checksums,
        "clips": [],
        "failures": failures,
    }
    for row in selected:
        path = os.path.join(audio_dir, row["filename"])
        if os.path.exists(path):
            manifest["clips"].append(
                {
                    "filename": row["filename"],
                    "category": row["category"],
                    "fold": int(row["fold"]),
                    "esc10": row["esc10"],
                    "bytes": os.path.getsize(path),
                    "sha256": sha256_file(path),
                }
            )
    # Manifest hash covers the exact clip set used by the benchmark.
    manifest_bytes = json.dumps(manifest["clips"], sort_keys=True).encode()
    manifest["manifest_sha256"] = hashlib.sha256(manifest_bytes).hexdigest()
    with open(os.path.join(data_dir, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)

    total_bytes = sum(c["bytes"] for c in manifest["clips"])
    print(
        f"done: {len(manifest['clips'])} clips, {total_bytes / 1e6:.1f} MB, "
        f"{len(failures)} failures, manifest sha256={manifest['manifest_sha256'][:16]}…"
    )
    if failures:
        print("FAILURES:", file=sys.stderr)
        for failure in failures[:20]:
            print(f"  {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
