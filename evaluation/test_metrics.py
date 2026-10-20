#!/usr/bin/env python3
"""Tests for the evaluation harness: metrics, thresholding, audio helpers.

Deliberately dependency-light (numpy + stdlib unittest) so they run anywhere the
benchmark itself runs:

    python3 -m unittest discover -s evaluation -p 'test_*.py'
"""

from __future__ import annotations

import unittest

import numpy as np

from run_benchmark import (
    BASELINE_PRESETS,
    HOP_SAMPLES,
    SAMPLE_RATE,
    WINDOW_SAMPLES,
    add_noise,
    alarm,
    baseline_alarm,
    binary_metrics,
    read_wav_16k,
    wilson_interval,
    windows,
)


class AlarmThresholdingTests(unittest.TestCase):
    def test_threshold_is_inclusive(self):
        scores = np.array([0.49, 0.5, 0.51])
        np.testing.assert_array_equal(alarm(scores, 0.5), np.array([0, 1, 1]))

    def test_decision_is_monotonic_in_threshold(self):
        rng = np.random.default_rng(7)
        scores = rng.random(200)
        fired = [alarm(scores, t).sum() for t in np.arange(0.1, 1.0, 0.1)]
        self.assertEqual(fired, sorted(fired, reverse=True))

    def test_single_high_window_alarms_the_whole_clip(self):
        # One loud window is enough; the decision is max-over-windows, not mean.
        scores = np.array([0.01, 0.01, 0.9, 0.01])
        self.assertEqual(int(alarm(scores, 0.5).max()), 1)


class BinaryMetricsTests(unittest.TestCase):
    def test_confusion_matrix_and_rates(self):
        labels = np.array([1, 1, 1, 0, 0, 0])
        preds = np.array([1, 0, 0, 0, 1, 0])
        metrics = binary_metrics(labels, preds)
        self.assertEqual(metrics["confusion_matrix"], {"tp": 1, "fn": 2, "fp": 1, "tn": 2})
        self.assertAlmostEqual(metrics["recall"], 1 / 3, places=4)
        self.assertAlmostEqual(metrics["precision"], 0.5, places=4)
        self.assertAlmostEqual(metrics["f1"], 0.4, places=4)
        self.assertAlmostEqual(metrics["false_positive_rate"], 1 / 3, places=4)

    def test_all_negative_predictions_do_not_divide_by_zero(self):
        metrics = binary_metrics(np.array([1, 0]), np.array([0, 0]))
        self.assertEqual(metrics["precision"], 0.0)
        self.assertEqual(metrics["recall"], 0.0)
        self.assertEqual(metrics["f1"], 0.0)

    def test_perfect_predictions(self):
        metrics = binary_metrics(np.array([1, 0]), np.array([1, 0]))
        self.assertEqual(metrics["accuracy"], 1.0)
        self.assertEqual(metrics["specificity"], 1.0)

    def test_wilson_interval_brackets_the_rate_and_is_bounded(self):
        low, high = wilson_interval(0, 40)
        self.assertLessEqual(low, 0.0 + 1e-9)
        self.assertLess(high, 0.1)
        low, high = wilson_interval(40, 40)
        self.assertGreater(low, 0.9)
        self.assertLessEqual(high, 1.0)


class AudioHelperTests(unittest.TestCase):
    def test_windows_uses_half_overlap_and_pads_the_tail(self):
        signal = np.zeros(5 * SAMPLE_RATE, dtype=np.float32)
        batch = windows(signal)
        self.assertEqual(batch.shape[1], WINDOW_SAMPLES)
        # 0.975 s windows stepping 0.4875 s across 5 s: starts at 0…70200, and the
        # final window runs past the end, so it must be zero-padded.
        self.assertEqual(batch.shape[0], 10)
        overhang = 9 * HOP_SAMPLES + WINDOW_SAMPLES - len(signal)
        self.assertGreater(overhang, 0)
        self.assertEqual(float(batch[-1, -overhang:].sum()), 0.0)

    def test_windows_returns_one_padded_window_for_a_short_clip(self):
        batch = windows(np.ones(100, dtype=np.float32))
        self.assertEqual(batch.shape, (1, WINDOW_SAMPLES))
        self.assertEqual(float(batch[0, 100:].sum()), 0.0)

    def test_add_noise_lands_within_one_db_of_the_requested_snr(self):
        rng = np.random.default_rng(3)
        signal = (0.3 * np.sin(2 * np.pi * 220 * np.arange(16000) / SAMPLE_RATE)).astype(np.float32)
        for target in (10.0, 5.0):
            mixed = add_noise(signal, target, seed=11)
            noise = mixed - signal
            measured = 20 * np.log10(
                np.sqrt(np.mean(signal**2)) / np.sqrt(np.mean(noise**2))
            )
            self.assertLess(abs(measured - target), 1.0, f"target {target} dB, measured {measured:.2f}")

    def test_add_noise_is_deterministic_for_a_seed(self):
        signal = np.zeros(SAMPLE_RATE, dtype=np.float32)
        np.testing.assert_allclose(add_noise(signal, 5, seed=1), add_noise(signal, 5, seed=1))

    def test_read_wav_16k_downmixes_and_resamples_esc50_style_audio(self):
        # ESC-50 ships 44.1 kHz 16-bit PCM; the model needs 16 kHz mono.
        import tempfile
        import wave

        tone = (0.5 * np.sin(2 * np.pi * 440 * np.arange(44100) / 44100)).astype(np.float32)
        stereo = np.stack([tone, tone], axis=1).reshape(-1)
        pcm = (stereo * 32767).astype("<i2")
        with tempfile.NamedTemporaryFile(suffix=".wav") as handle:
            with wave.open(handle.name, "wb") as writer:
                writer.setnchannels(2)
                writer.setsampwidth(2)
                writer.setframerate(44100)
                writer.writeframes(pcm.tobytes())
            signal = read_wav_16k(handle.name)
        self.assertAlmostEqual(len(signal) / SAMPLE_RATE, 1.0, delta=0.01)
        self.assertLessEqual(float(np.max(np.abs(signal))), 1.0)


class ShippedBaselineTests(unittest.TestCase):
    """The mirrored heuristic must behave like the TypeScript original."""

    def _tone(self, amplitude: float, seconds: float = 1.0, freq: float = 200.0) -> np.ndarray:
        t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
        return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)

    def test_quiet_input_never_alarms(self):
        quiet = self._tone(0.005)
        for preset in BASELINE_PRESETS:
            self.assertFalse(baseline_alarm(quiet, preset), preset)

    def test_loud_voiced_tone_alarms_at_every_preset(self):
        loud = self._tone(1.0)
        for preset in BASELINE_PRESETS:
            self.assertTrue(baseline_alarm(loud, preset), preset)

    def test_loud_non_voiced_noise_is_discounted_but_still_alarms_at_high(self):
        rng = np.random.default_rng(5)
        broadband = (rng.random(SAMPLE_RATE) * 2 - 1).astype(np.float32)
        self.assertTrue(baseline_alarm(broadband, "high"))

    def test_baseline_alarm_is_monotonic_in_sensitivity(self):
        # Anything the low preset flags, the high preset must flag too.
        moderate = self._tone(0.2)
        if baseline_alarm(moderate, "low"):
            self.assertTrue(baseline_alarm(moderate, "high"))


if __name__ == "__main__":
    unittest.main()
