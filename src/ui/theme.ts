/**
 * Design tokens — dark, high-contrast, safety-first palette with large
 * touch targets. Colors chosen for WCAG AA contrast on text.
 */

import { Platform } from 'react-native';

export const colors = {
  background: '#0B0F14',
  surface: '#151B23',
  surfaceAlt: '#1D2630',
  border: '#2A3644',
  text: '#F2F5F8',
  textMuted: '#9AA8B6',
  primary: '#2F6FED',
  primaryText: '#FFFFFF',
  danger: '#D93025',
  dangerSurface: '#3A1512',
  warning: '#F2A900',
  success: '#1E8E3E',
  successSurface: '#122A1A',
  info: '#5DC9E8',
  overlay: 'rgba(5, 8, 12, 0.85)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
};

export const typography = {
  title: Platform.select({ ios: 'System', default: 'sans-serif' }) as string,
};

export const statusColors: Record<string, string> = {
  implemented: colors.success,
  prototype: colors.warning,
  'requires-dev-build': colors.info,
  'requires-hardware': colors.info,
  'not-implemented': colors.textMuted,
  delivered: colors.success,
  simulated: colors.warning,
  failed: colors.danger,
  pending: colors.textMuted,
  sent: colors.info,
  queued: colors.info,
};
