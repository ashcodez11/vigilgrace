/**
 * Gothic Noir theme — obsidian, charcoal, deep plum, oxblood,
 * muted silver and ivory, elegant typography with subtle botanical detailing.
 */

import type { SemanticTokens } from '../tokens/semantic';

export type ThemeId = 'gothic-noir' | 'soft-girl' | 'ivory-rose' | 'black-cherry';

export interface Theme {
  id: ThemeId;
  name: string;
  /** Present on the reference-palette themes; components fall back to colors otherwise. */
  semantic?: SemanticTokens;
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    border: string;
    text: string;
    textMuted: string;
    primary: string;
    primaryText: string;
    danger: string;
    dangerSurface: string;
    warning: string;
    success: string;
    successSurface: string;
    info: string;
    overlay: string;
    botanicalLeaf: string;
    botanicalVine: string;
  };
  typography: {
    elegantSerif: boolean;
    letterSpacing: number;
  };
  effects: {
    shadowColor: string;
    shadowOpacity: number;
    shadowRadius: number;
    shadowOffset: { width: number; height: number };
  };
}

export const gothicNoirTheme: Theme = {
  id: 'gothic-noir',
  name: 'Gothic Noir',

  colors: {
    background: '#0D1117',
    surface: '#161B22',
    surfaceAlt: '#21262D',
    border: '#30363D',
    text: '#F0EDE9',
    textMuted: '#B8B3AE',
    primary: '#8B7A9F',
    primaryText: '#F0EDE9',
    danger: '#D94848',
    dangerSurface: '#2D1818',
    warning: '#C9A857',
    success: '#5D8A5D',
    successSurface: '#1C2820',
    info: '#6B7D92',
    overlay: 'rgba(13, 17, 23, 0.94)',
    botanicalLeaf: '#5D7860',
    botanicalVine: '#7A6570',
  },

  typography: {
    elegantSerif: false,
    letterSpacing: 0.2,
  },

  effects: {
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
};
