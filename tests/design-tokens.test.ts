import { describe, expect, it } from 'vitest';

import { darkTokens, lightTokens, type SemanticTokens } from '@/ui/tokens/semantic';

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const suites: Array<[string, SemanticTokens]> = [
  ['Ivory Rose (light)', lightTokens],
  ['Black Cherry (dark)', darkTokens],
];

describe.each(suites)('%s contrast', (_name, t) => {
  it.each([
    ['textPrimary on bg', t.textPrimary, t.bg],
    ['textPrimary on surface', t.textPrimary, t.surface],
    ['textSecondary on bg', t.textSecondary, t.bg],
    ['textSecondary on surfaceSunken', t.textSecondary, t.surfaceSunken],
    ['textOnAccent on accent', t.textOnAccent, t.accent],
    ['textOnEmergency on emergency', t.textOnEmergency, t.emergency],
    ['dangerText on bg', t.dangerText, t.bg],
    ['success on bg', t.success, t.bg],
    ['warning on bg', t.warning, t.bg],
    ['info on bg', t.info, t.bg],
  ])('%s >= 4.5:1', (_l, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['borderStrong on bg', t.borderStrong, t.bg],
    ['emergency on bg', t.emergency, t.bg],
    ['focusRing on bg', t.focusRing, t.bg],
  ])('%s >= 3:1 (non-text)', (_l, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
