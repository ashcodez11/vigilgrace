import { useTheme } from '../theme-context';
import { lightTokens, type SemanticTokens } from '../tokens/semantic';

/** Semantic tokens for the active theme; legacy themes are mapped from `colors`. */
export function useTokens(): SemanticTokens {
  const { theme } = useTheme();
  if (theme.semantic) return theme.semantic;
  const c = theme.colors;
  return {
    ...lightTokens,
    bg: c.background,
    surface: c.surface,
    surfaceElevated: c.surface,
    surfaceSunken: c.surfaceAlt,
    textPrimary: c.text,
    textSecondary: c.textMuted,
    textOnAccent: c.primaryText,
    separator: c.border,
    borderStrong: c.textMuted,
    accent: c.primary,
    accentPressed: c.primary,
    accentSoft: c.surfaceAlt,
    emergency: c.danger,
    emergencyPressed: c.danger,
    textOnEmergency: '#FFFFFF',
    dangerText: c.danger,
    success: c.success,
    warning: c.warning,
    info: c.info,
    focusRing: c.primary,
  };
}
