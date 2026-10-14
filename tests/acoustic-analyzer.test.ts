import { describe, expect, it } from 'vitest';

import {
  ACOUSTIC_PRESETS,
  AcousticDistressAnalyzer,
  DEFAULT_ACOUSTIC_CONFIG,
  computeFeatures,
  configForSensitivity,
  looksVoiced,
} from '@/core/voice/acoustic-analyzer';

const SAMPLE_RATE = 16000;

/** Build a sine window at a given amplitude (0..1). */
function sineWindow(amplitude: number, freq = 220, samples = 1600): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  }
  return out;
}

function noiseWindow(amplitude: number, samples = 1600): Float32Array {
  const out = new Float32Array(samples);
  let state = 1;
  for (let i = 0; i < samples; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = amplitude * ((state / 0x7fffffff) * 2 - 1);
  }
  return out;
}

describe('computeFeatures', () => {
  it('computes dBFS for silence as ≤ -100', () => {
    const f = computeFeatures(new Float32Array(1600), SAMPLE_RATE);
    expect(f.dbfs).toBeLessThanOrEqual(-100);
    expect(f.windowMs).toBeCloseTo(100, 5);
  });

  it('computes dBFS for a full-scale sine around -3 dB', () => {
    const f = computeFeatures(sineWindow(1), SAMPLE_RATE);
    expect(f.dbfs).toBeGreaterThan(-4);
    expect(f.dbfs).toBeLessThan(-2);
  });

  it('speech-band sine looks voiced, high-frequency noise does not', () => {
    expect(looksVoiced(computeFeatures(sineWindow(0.5, 180), SAMPLE_RATE).zcr, -12)).toBe(true);
    expect(looksVoiced(computeFeatures(noiseWindow(0.5), SAMPLE_RATE).zcr, -12)).toBe(false);
  });
});

describe('AcousticDistressAnalyzer', () => {
  it('is inert when disabled (privacy default)', () => {
    const analyzer = new AcousticDistressAnalyzer({ ...DEFAULT_ACOUSTIC_CONFIG, enabled: false });
    for (let t = 0; t < 10000; t += 100) {
      const r = analyzer.analyze(sineWindow(1), SAMPLE_RATE, t);
      expect(r.event).toBeNull();
    }
  });

  it('fires after a sustained loud voiced burst', () => {
    const analyzer = new AcousticDistressAnalyzer(
      configForSensitivity('high', { enabled: true, cooldownMs: 0 }),
    );
    let event = null;
    let t = 0;
    for (let i = 0; i < 10 && !event; i += 1, t += 100) {
      event = analyzer.analyze(sineWindow(0.8, 300), SAMPLE_RATE, t).event;
    }
    expect(event).not.toBeNull();
    expect(event!.confidence).toBeGreaterThan(0);
    expect(event!.voiced).toBe(true);
  });

  it('does not fire on quiet background levels', () => {
    const analyzer = new AcousticDistressAnalyzer({ ...DEFAULT_ACOUSTIC_CONFIG, enabled: true });
    let fired = false;
    for (let t = 0; t < 20000; t += 100) {
      fired ||= analyzer.analyze(sineWindow(0.01), SAMPLE_RATE, t).event !== null;
    }
    expect(fired).toBe(false);
  });

  it('gives lower confidence to non-voiced noise than to speech-like input', () => {
    const mk = () =>
      new AcousticDistressAnalyzer(
        // low confidence gate so both event types can be observed and compared
        configForSensitivity('low', { enabled: true, cooldownMs: 0, minConfidence: 0.3 }),
      );

    const voiced = mk();
    let speechEvent = null;
    for (let t = 0; t < 5000 && !speechEvent; t += 100) {
      speechEvent = voiced.analyze(sineWindow(1, 240), SAMPLE_RATE, t).event;
    }

    const noisy = mk();
    let noiseEvent = null;
    for (let t = 0; t < 5000 && !noiseEvent; t += 100) {
      noiseEvent = noisy.analyze(noiseWindow(1), SAMPLE_RATE, t).event;
    }

    expect(speechEvent).not.toBeNull();
    expect(noiseEvent).not.toBeNull();
    expect(speechEvent!.confidence).toBeGreaterThan(noiseEvent!.confidence);
  });

  it('respects the cooldown between events', () => {
    const analyzer = new AcousticDistressAnalyzer(
      configForSensitivity('high', { enabled: true, cooldownMs: 5000 }),
    );
    let first = null;
    for (let t = 0; t < 3000 && !first; t += 100) {
      first = analyzer.analyze(sineWindow(1, 300), SAMPLE_RATE, t).event;
    }
    expect(first).not.toBeNull();

    // immediately keep shouting — no second event during cooldown
    let second: typeof first = null;
    for (let t = 3100; t < 4000 && !second; t += 100) {
      second = analyzer.analyze(sineWindow(1, 300), SAMPLE_RATE, t).event;
    }
    expect(second).toBeNull();
  });

  it('high-confidence auto-action requires corroboration to be enabled', () => {
    const strict = new AcousticDistressAnalyzer(
      configForSensitivity('high', { enabled: true, cooldownMs: 0, requireCorroboration: true }),
    );
    let strictEvent = null;
    for (let t = 0; t < 3000 && !strictEvent; t += 100) {
      strictEvent = strict.analyze(sineWindow(1, 300), SAMPLE_RATE, t).event;
    }
    expect(strictEvent!.highConfidence).toBe(false);

    const loose = new AcousticDistressAnalyzer(
      configForSensitivity('high', { enabled: true, cooldownMs: 0, requireCorroboration: false }),
    );
    let looseEvent = null;
    for (let t = 0; t < 3000 && !looseEvent; t += 100) {
      looseEvent = loose.analyze(sineWindow(1, 300), SAMPLE_RATE, t).event;
    }
    expect(looseEvent!.highConfidence).toBe(true);
  });

  it('presets are ordered: high sensitivity triggers at quieter levels', () => {
    expect(ACOUSTIC_PRESETS.high.burstThresholdDb).toBeLessThan(
      ACOUSTIC_PRESETS.medium.burstThresholdDb,
    );
    expect(ACOUSTIC_PRESETS.medium.burstThresholdDb).toBeLessThan(
      ACOUSTIC_PRESETS.low.burstThresholdDb,
    );
  });
});
