/**
 * Voice distress detection — lightweight, privacy-first acoustic prototype.
 *
 * What this actually does (be honest with yourself about the limits):
 *  - Streams short PCM windows from the microphone (expo-audio AudioStream).
 *  - Computes per-window RMS in dBFS and zero-crossing rate (ZCR).
 *  - Fires a "distress-like burst" event when the level stays above a
 *    configurable threshold for a minimum duration, with hysteresis/cooldown.
 *  - Produces a confidence score that is down-weighted for non-voiced content
 *    (music, wind, white noise have very different ZCR profiles than speech).
 *
 * What it does NOT do: speech recognition, keyword matching, speaker ID, or
 * anything that requires the audio to leave the device. The keyword list in
 * config is kept for UI + future on-device ASR / backend inference and is
 * NOT matched against audio in this build. Ordinary loud speech, music or
 * traffic noise can still produce events — that is why corroboration with
 * other signals is required before an automatic SOS by default.
 *
 * No raw audio is retained by this module: only scalar features.
 */

export type VoiceSensitivity = 'low' | 'medium' | 'high';

export interface AcousticConfig {
  enabled: boolean;
  /** RMS threshold in dBFS required to start a burst. */
  burstThresholdDb: number;
  /** How long the signal must stay above threshold (ms). */
  minBurstMs: number;
  /** Quiet period after an event (ms). */
  cooldownMs: number;
  /** Minimum confidence before an event is emitted. */
  minConfidence: number;
  /**
   * When true a low/medium confidence event only *suggests* an emergency;
   * auto-SOS requires corroboration (motion/pendant/manual confirm).
   */
  requireCorroboration: boolean;
  /** Distress keywords reserved for ASR-based matching (not matched on-device yet). */
  keywords: string[];
}

export const ACOUSTIC_PRESETS: Record<VoiceSensitivity, Pick<AcousticConfig, 'burstThresholdDb' | 'minBurstMs' | 'minConfidence'>> = {
  // dBFS (0 dBFS = full scale). Higher (less negative) threshold = fewer triggers.
  low: { burstThresholdDb: -18, minBurstMs: 350, minConfidence: 0.65 },
  medium: { burstThresholdDb: -24, minBurstMs: 250, minConfidence: 0.55 },
  high: { burstThresholdDb: -30, minBurstMs: 150, minConfidence: 0.45 },
};

export const DEFAULT_ACOUSTIC_CONFIG: AcousticConfig = {
  enabled: false,
  ...ACOUSTIC_PRESETS.medium,
  cooldownMs: 10000,
  requireCorroboration: true,
  keywords: ['help', 'bachao', 'save me', 'emergency'],
};

export function configForSensitivity(
  sensitivity: VoiceSensitivity,
  overrides: Partial<AcousticConfig> = {},
): AcousticConfig {
  return { ...DEFAULT_ACOUSTIC_CONFIG, ...ACOUSTIC_PRESETS[sensitivity], ...overrides };
}

export interface AcousticFeatures {
  /** RMS level in dBFS (−100…0). */
  dbfs: number;
  /** Zero-crossing rate in [0, 1]. Speech ≈ 0.02–0.2, hiss > 0.3. */
  zcr: number;
  windowMs: number;
}

export function computeFeatures(samples: Float32Array, sampleRate: number): AcousticFeatures {
  let sumSq = 0;
  let crossings = 0;
  let prev = samples.length > 0 ? samples[0]! : 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!;
    sumSq += v * v;
    if ((v >= 0 && prev < 0) || (v < 0 && prev >= 0)) crossings += 1;
    prev = v;
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSq / samples.length) : 0;
  const dbfs = rms > 0 ? 20 * Math.log10(Math.min(1, rms)) : -100;
  const zcr = samples.length > 1 ? crossings / (samples.length - 1) : 0;
  const windowMs = (samples.length / Math.max(1, sampleRate)) * 1000;
  return { dbfs, zcr, windowMs };
}

/** Rough heuristic: does this window look like voiced human speech? */
export function looksVoiced(zcr: number, dbfs: number): boolean {
  if (dbfs < -45) return false;
  return zcr >= 0.01 && zcr <= 0.25;
}

export interface DistressEvent {
  confidence: number;
  dbfs: number;
  zcr: number;
  voiced: boolean;
  /** True when confidence alone is high enough to consider auto-action. */
  highConfidence: boolean;
}

export interface AnalyzerEvaluation {
  features: AcousticFeatures;
  burstMs: number;
  event: DistressEvent | null;
}

export class AcousticDistressAnalyzer {
  private burstMs = 0;
  private lastEventAt = -Infinity;

  constructor(private config: AcousticConfig = DEFAULT_ACOUSTIC_CONFIG) {}

  setConfig(config: AcousticConfig): void {
    this.config = config;
    this.reset();
  }

  getConfig(): AcousticConfig {
    return this.config;
  }

  reset(): void {
    this.burstMs = 0;
    this.lastEventAt = -Infinity;
  }

  /** Feed one PCM window (mono, float32 in [−1, 1]). */
  analyze(samples: Float32Array, sampleRate: number, tMs: number): AnalyzerEvaluation {
    const features = computeFeatures(samples, sampleRate);
    const cfg = this.config;

    if (!cfg.enabled) {
      this.burstMs = 0;
      return { features, burstMs: 0, event: null };
    }

    if (features.dbfs >= cfg.burstThresholdDb) {
      this.burstMs += features.windowMs;
    } else {
      // decay so brief dips inside one utterance do not reset immediately
      this.burstMs = Math.max(0, this.burstMs - features.windowMs * 1.5);
    }

    if (this.burstMs < cfg.minBurstMs || tMs - this.lastEventAt < cfg.cooldownMs) {
      return { features, burstMs: this.burstMs, event: null };
    }

    const voiced = looksVoiced(features.zcr, features.dbfs);
    // Confidence: how far above threshold, capped, then discounted for
    // non-speech-like spectra (music/hiss/wind are the usual false alarms).
    const exceedance = (features.dbfs - cfg.burstThresholdDb) / 12;
    const levelScore = Math.max(0, Math.min(1, exceedance));
    const raw = levelScore * (voiced ? 1 : 0.55);
    const confidence = Math.round(Math.min(1, raw + (voiced ? 0.15 : 0)) * 100) / 100;

    if (confidence < cfg.minConfidence) {
      return { features, burstMs: this.burstMs, event: null };
    }

    this.lastEventAt = tMs;
    this.burstMs = 0;
    const highConfidence = confidence >= 0.8 && !cfg.requireCorroboration;
    return {
      features,
      burstMs: this.burstMs,
      event: { confidence, dbfs: features.dbfs, zcr: features.zcr, voiced, highConfidence },
    };
  }
}
