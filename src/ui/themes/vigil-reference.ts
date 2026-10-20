/**
 * Reference-palette themes: "Ivory Rose" (light) and "Black Cherry" (dark).
 * Built from semantic tokens so legacy `colors` keys stay in sync.
 */
import { darkTokens, lightTokens, type SemanticTokens } from '../tokens/semantic';
import { palette as p } from '../tokens/palette';
import type { Theme } from './gothic-noir';

function build(
  id: Theme['id'],
  name: string,
  t: SemanticTokens,
  extra: { dangerSurface: string; successSurface: string; overlay: string; shadowColor: string; shadowOpacity: number },
): Theme {
  return {
    id,
    name,
    semantic: t,
    colors: {
      background: t.bg,
      surface: t.surface,
      surfaceAlt: t.surfaceSunken,
      border: t.separator,
      text: t.textPrimary,
      textMuted: t.textSecondary,
      primary: t.accent,
      primaryText: t.textOnAccent,
      danger: t.emergency,
      dangerSurface: extra.dangerSurface,
      warning: t.warning,
      success: t.success,
      successSurface: extra.successSurface,
      info: t.info,
      overlay: extra.overlay,
      botanicalLeaf: p.sageLeafDeep,
      botanicalVine: p.roseDust,
    },
    typography: { elegantSerif: false, letterSpacing: 0.1 },
    effects: {
      shadowColor: extra.shadowColor,
      shadowOpacity: extra.shadowOpacity,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
  };
}

export const ivoryRoseTheme = build('ivory-rose', 'Ivory Rose', lightTokens, {
  dangerSurface: '#F8E1E5',
  successSurface: '#E6EDE3',
  overlay: 'rgba(246, 242, 239, 0.96)',
  shadowColor: p.burgundy,
  shadowOpacity: 0.08,
});

export const blackCherryTheme = build('black-cherry', 'Black Cherry', darkTokens, {
  dangerSurface: '#3A0F1B',
  successSurface: '#1E2A1E',
  overlay: 'rgba(28, 11, 18, 0.94)',
  shadowColor: '#000000',
  shadowOpacity: 0.35,
});
