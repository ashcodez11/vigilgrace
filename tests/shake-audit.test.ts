/**
 * Shake-to-SOS audit — realistic synthetic accelerometer sequences.
 *
 * These tests replay synthetic sensor sequences (60 Hz, magnitude in g, exactly
 * what `ShakeDetectorEngine.push` receives from Expo's Accelerometer) through
 * the shipped detector. Existing unit tests use idealised spikes; these use
 * movement patterns the phone actually sees, to pin down false positives and
 * missed detections. The measured numbers behind the FINDING markers are in
 * docs/SHAKE_DETECTION_AUDIT.md.
 *
 * FINDING tests assert today's behaviour (which is wrong or risky) rather than
 * the desired behaviour, so that changing the detector is a deliberate,
 * visible edit. See the audit document for the recommended fix.
 */

import { describe, expect, it } from 'vitest';

import {
  SENSITIVITY_PRESETS,
  ShakeDetectorEngine,
  type ShakeSensitivity,
} from '@/core/motion/shake-detector';

const STEP_MS = 1000 / 60;
const PRESETS: ShakeSensitivity[] = ['low', 'medium', 'high'];

function engineFor(sensitivity: ShakeSensitivity) {
  return new ShakeDetectorEngine(SENSITIVITY_PRESETS[sensitivity]);
}

/**
 * Replay a magnitude sequence at 60 Hz. Magnitude is placed on a single axis,
 * so |a| equals the requested g value (a real phone splits it across axes; the
 * detector only ever uses the magnitude).
 */
function replay(
  engine: ShakeDetectorEngine,
  durationMs: number,
  magnitudeAt: (tMs: number) => number,
  startMs = 0,
): { triggered: boolean; maxPeaks: number } {
  let triggered = false;
  let maxPeaks = 0;
  for (let t = startMs; t < startMs + durationMs; t += STEP_MS) {
    const result = engine.push({ x: magnitudeAt(t - startMs), y: 0, z: 0, tMs: t });
    triggered ||= result.triggered;
    maxPeaks = Math.max(maxPeaks, result.peaksInWindow);
  }
  return { triggered, maxPeaks };
}

/** Normal walking: ~1.9 steps/s vertical bounce plus its first harmonic. */
const walking = (tMs: number) => {
  const t = tMs / 1000;
  return 1 + 0.25 * Math.sin(2 * Math.PI * 1.9 * t) + 0.06 * Math.sin(2 * Math.PI * 3.8 * t);
};

/** Deliberate 4 Hz hand shake, ±0.9 g — the gesture the feature exists for. */
const vigorousShake = (tMs: number) => 1 + 0.9 * Math.sin(2 * Math.PI * 4 * (tMs / 1000));

describe('shake audit — false positives from ordinary movement', () => {
  it('does not trigger while walking at the default (medium) preset', () => {
    expect(replay(engineFor('medium'), 20_000, walking).triggered).toBe(false);
  });

  it('does not trigger while walking at the low preset', () => {
    expect(replay(engineFor('low'), 20_000, walking).triggered).toBe(false);
  });

  // FINDING F1 (docs/SHAKE_DETECTION_AUDIT.md#f1): the high preset peaks at
  // 0.25 g, below ordinary walking peaks (~0.31 g with the harmonic above), so
  // a walk can start an SOS countdown.
  it('FINDING F1: walking does trigger at the high preset', () => {
    expect(replay(engineFor('high'), 20_000, walking).triggered).toBe(true);
  });

  it('does not trigger for a phone at rest with handling noise', () => {
    for (const preset of PRESETS) {
      const idle = (tMs: number) => 1 + 0.05 * Math.sin(2 * Math.PI * 0.7 * (tMs / 1000));
      expect(replay(engineFor(preset), 15_000, idle).triggered, `preset ${preset}`).toBe(false);
    }
  });

  it('does not trigger from a single drop impact (2.4 g, one sample)', () => {
    for (const preset of PRESETS) {
      const dropped = (tMs: number) => (tMs < STEP_MS ? 2.4 : 1);
      expect(replay(engineFor(preset), 6000, dropped).triggered, `preset ${preset}`).toBe(false);
    }
  });

  it('does not trigger from two isolated 1.6 g bumps 1.3 s apart', () => {
    for (const preset of PRESETS) {
      const bumps = (tMs: number) => (tMs < STEP_MS || Math.abs(tMs - 1300) < STEP_MS ? 1.6 : 1);
      expect(replay(engineFor(preset), 6000, bumps).triggered, `preset ${preset}`).toBe(false);
    }
  });

  // FINDING F2 (docs/SHAKE_DETECTION_AUDIT.md#f2): a sustained non-1 g offset
  // (lift, braking car, phone pressed hard against the body) counts as a fresh
  // peak every peakMinSpacingMs, so it triggers with no oscillation at all.
  it('FINDING F2: a constant 1.4 g offset triggers at medium and high', () => {
    const offset = () => 1.4;
    expect(replay(engineFor('medium'), 3000, offset).triggered).toBe(true);
    expect(replay(engineFor('high'), 3000, offset).triggered).toBe(true);
    // threshold 0.5 g keeps the low preset clear of a 0.4 g offset
    expect(replay(engineFor('low'), 3000, offset).triggered).toBe(false);
  });
});

describe('shake audit — deliberate shakes still fire', () => {
  for (const preset of PRESETS) {
    it(`triggers within 1 s at the ${preset} preset`, () => {
      const engine = engineFor(preset);
      expect(replay(engine, 1000, vigorousShake).triggered, `preset ${preset}`).toBe(true);
    });
  }

  it('does not fire twice inside the cooldown, then fires again afterwards', () => {
    const engine = engineFor('medium');
    expect(replay(engine, 800, vigorousShake).triggered).toBe(true);

    // Keep shaking through the cooldown: no second trigger.
    const inCooldown = replay(
      engine,
      SENSITIVITY_PRESETS.medium.cooldownMs - 1000,
      vigorousShake,
      1000,
    );
    expect(inCooldown.triggered).toBe(false);

    const afterCooldown = replay(
      engine,
      1500,
      vigorousShake,
      1000 + SENSITIVITY_PRESETS.medium.cooldownMs,
    );
    expect(afterCooldown.triggered).toBe(true);
  });

  it('reset() clears partial state so a wound-up gesture cannot carry over', () => {
    const engine = engineFor('high');
    replay(engine, 300, () => 1.5); // one peak, below minPeaks
    engine.reset();
    expect(replay(engine, 100, () => 1.5, 10_000).triggered).toBe(false);
  });

  it('documents the trade-off: the low preset ignores a moderate 0.45 g shake', () => {
    const moderate = (tMs: number) => 1 + 0.45 * Math.sin(2 * Math.PI * 4 * (tMs / 1000));
    expect(replay(engineFor('low'), 3000, moderate).triggered).toBe(false);
    expect(replay(engineFor('medium'), 3000, moderate).triggered).toBe(true);
  });
});
