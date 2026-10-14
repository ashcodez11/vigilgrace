/**
 * Soft Girl theme — blush, cream, butter yellow, lavender and sage,
 * rounded cards, soft shadows and generous spacing.
 */

import type { Theme } from './gothic-noir';

export const softGirlTheme: Theme = {
  id: 'soft-girl',
  name: 'Soft Girl',

  colors: {
    background: '#FBF7F4',
    surface: '#FFFFFF',
    surfaceAlt: '#FFF6F1',
    border: '#E6D5CC',
    text: '#3A3330',
    textMuted: '#7A706B',
    primary: '#C9918D',
    primaryText: '#FFFFFF',
    danger: '#E67C7C',
    dangerSurface: '#FFEEEC',
    warning: '#E8C26F',
    success: '#8FB88F',
    successSurface: '#EDF5ED',
    info: '#9BA4D4',
    overlay: 'rgba(251, 247, 244, 0.96)',
    botanicalLeaf: '#B0CFAF',
    botanicalVine: '#D9B8C8',
  },

  typography: {
    elegantSerif: false,
    letterSpacing: 0.15,
  },

  effects: {
    shadowColor: '#C9918D',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
};
