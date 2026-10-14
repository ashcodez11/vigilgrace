/**
 * Shake-to-SOS detection algorithm.
 *
 * Pure logic (no React Native imports) so it is unit-testable and reusable.
 * Detection model: count acceleration "peaks" — samples whose magnitude
 * deviates from 1 g by more than a configurable threshold — inside a sliding
 * time window. Enough peaks inside the window plus a mandatory cooldown
 * after any trigger protects against false positives from single bumps.
 *
 * Foreground only: Expo sensors do not deliver accelerometer updates while
 * the app is backgrounded. See docs/security/monitoring-status.md.
 */

export interface ShakeSample {
  /** g-force on each axis (Expo Accelerometer units). */
  x: number;
  y: number;
  z: number;
  /** Milliseconds (epoch or relative — only deltas matter). */
  tMs: number;
}

export interface ShakeConfig {
  /** Number of peaks inside `windowMs` required to trigger. */
  minPeaks: number;
  /** Minimum |‖a‖ − 1 g| for a sample to count as a peak. */
  peakThresholdG: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Mandatory quiet period after a trigger. */
  cooldownMs: number;
  /** Minimum spacing between two counted peaks (debounce). */
  peakMinSpacingMs: number;
}

export const DEFAULT_SHAKE_CONFIG: ShakeConfig = {
  minPeaks: 3,
  peakThresholdG: 0.35,
  windowMs: 1200,
  cooldownMs: 8000,
  peakMinSpacingMs: 80,
};

export type ShakeSensitivity = 'low' | 'medium' | 'high';

/** Sensible presets. Higher sensitivity = lower threshold / fewer peaks needed. */
export const SENSITIVITY_PRESETS: Record<ShakeSensitivity, ShakeConfig> = {
  low: { minPeaks: 4, peakThresholdG: 0.5, windowMs: 1200, cooldownMs: 10000, peakMinSpacingMs: 80 },
  medium: DEFAULT_SHAKE_CONFIG,
  high: { minPeaks: 3, peakThresholdG: 0.25, windowMs: 1500, cooldownMs: 10000, peakMinSpacingMs: 60 },
};

export interface ShakeEvaluation {
  triggered: boolean;
  /** Number of peaks currently inside the window. */
  peaksInWindow: number;
  deviationG: number;
  inCooldown: boolean;
}

export class ShakeDetectorEngine {
  private peaks: number[] = [];
  private cooldownUntil = -Infinity;
  private lastPeakAt = -Infinity;

  constructor(private config: ShakeConfig = DEFAULT_SHAKE_CONFIG) {}

  setConfig(config: ShakeConfig): void {
    this.config = config;
    this.reset();
  }

  getConfig(): ShakeConfig {
    return this.config;
  }

  reset(): void {
    this.peaks = [];
    this.cooldownUntil = -Infinity;
    this.lastPeakAt = -Infinity;
  }

  /** Feed one accelerometer sample; returns the evaluation for this sample. */
  push(sample: ShakeSample): ShakeEvaluation {
    const { minPeaks, peakThresholdG, windowMs, cooldownMs, peakMinSpacingMs } = this.config;
    const magnitude = Math.sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z);
    const deviationG = Math.abs(magnitude - 1);

    // Drop peaks that aged out of the sliding window.
    const windowStart = sample.tMs - windowMs;
    this.peaks = this.peaks.filter((t) => t >= windowStart);

    const inCooldown = sample.tMs < this.cooldownUntil;
    let triggered = false;

    if (
      deviationG >= peakThresholdG &&
      sample.tMs - this.lastPeakAt >= peakMinSpacingMs
    ) {
      this.peaks.push(sample.tMs);
      this.lastPeakAt = sample.tMs;

      if (!inCooldown && this.peaks.length >= minPeaks) {
        triggered = true;
        this.cooldownUntil = sample.tMs + cooldownMs;
        this.peaks = [];
      }
    }

    return {
      triggered,
      peaksInWindow: this.peaks.length,
      deviationG,
      inCooldown: sample.tMs < this.cooldownUntil || triggered,
    };
  }
}
