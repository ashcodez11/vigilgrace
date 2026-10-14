import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHAKE_CONFIG,
  SENSITIVITY_PRESETS,
  ShakeDetectorEngine,
} from '@/core/motion/shake-detector';

function sample(tMs: number, deviation: number) {
  // magnitude = 1 + deviation on the x axis
  return { x: 1 + deviation, y: 0, z: 0, tMs };
}

describe('ShakeDetectorEngine', () => {
  it('does not trigger below the peak threshold', () => {
    const engine = new ShakeDetectorEngine();
    for (let i = 0; i < 20; i += 1) {
      const result = engine.push(sample(i * 50, 0.05));
      expect(result.triggered).toBe(false);
    }
  });

  it('triggers after enough peaks inside the window', () => {
    const engine = new ShakeDetectorEngine();
    let triggered = false;
    for (let i = 0; i < DEFAULT_SHAKE_CONFIG.minPeaks && !triggered; i += 1) {
      triggered = engine.push(sample(i * 100, 0.6)).triggered;
    }
    expect(triggered).toBe(true);
  });

  it('does not trigger if peaks are spread wider than the window', () => {
    const engine = new ShakeDetectorEngine();
    let triggered = false;
    for (let i = 0; i < 10; i += 1) {
      const t = i * (DEFAULT_SHAKE_CONFIG.windowMs + 100);
      const result = engine.push(sample(t, 0.6));
      triggered ||= result.triggered;
    }
    expect(triggered).toBe(false);
  });

  it('enforces cooldown after a trigger', () => {
    const engine = new ShakeDetectorEngine();
    for (let i = 0; i < DEFAULT_SHAKE_CONFIG.minPeaks; i += 1) {
      engine.push(sample(i * 100, 0.6));
    }
    const start = DEFAULT_SHAKE_CONFIG.minPeaks * 100 + 10;
    let secondTrigger = false;
    for (let i = 0; i < DEFAULT_SHAKE_CONFIG.minPeaks; i += 1) {
      secondTrigger ||= engine.push(sample(start + i * 100, 0.6)).triggered;
    }
    expect(secondTrigger).toBe(false);

    // after the cooldown expires it may trigger again
    const afterCooldown = start + DEFAULT_SHAKE_CONFIG.cooldownMs + 1000;
    let thirdTrigger = false;
    for (let i = 0; i < DEFAULT_SHAKE_CONFIG.minPeaks && !thirdTrigger; i += 1) {
      thirdTrigger = engine.push(sample(afterCooldown + i * 100, 0.6)).triggered;
    }
    expect(thirdTrigger).toBe(true);
  });

  it('debounces peaks that are too close together (contact bounce)', () => {
    const cfg = { ...DEFAULT_SHAKE_CONFIG, peakMinSpacingMs: 80 };
    const engine = new ShakeDetectorEngine(cfg);
    let triggered = false;
    // 6 peaks 10 ms apart count as at most 1 peak due to spacing
    for (let i = 0; i < 6; i += 1) {
      triggered ||= engine.push(sample(i * 10, 0.6)).triggered;
    }
    expect(triggered).toBe(false);
  });

  it('sensitivity presets are ordered sensibly', () => {
    expect(SENSITIVITY_PRESETS.high.peakThresholdG).toBeLessThan(
      SENSITIVITY_PRESETS.medium.peakThresholdG,
    );
    expect(SENSITIVITY_PRESETS.medium.peakThresholdG).toBeLessThan(
      SENSITIVITY_PRESETS.low.peakThresholdG,
    );
  });
});
