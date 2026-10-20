/**
 * Theme context and provider for dual-theme support.
 * Persists theme choice to settings store.
 */

import { createContext, useContext, type ReactNode } from 'react';

import { gothicNoirTheme, type Theme, type ThemeId } from './themes/gothic-noir';
import { softGirlTheme } from './themes/soft-girl';
import { blackCherryTheme, ivoryRoseTheme } from './themes/vigil-reference';

export type { ThemeId, Theme };

export const themes: Record<ThemeId, Theme> = {
  'gothic-noir': gothicNoirTheme,
  'soft-girl': softGirlTheme,
  'ivory-rose': ivoryRoseTheme,
  'black-cherry': blackCherryTheme,
};

interface ThemeContextValue {
  theme: Theme;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider({
  children,
  themeId,
  setThemeId,
}: {
  children: ReactNode;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
}) {
  const theme = themes[themeId];
  return <ThemeContext.Provider value={{ theme, themeId, setThemeId }}>{children}</ThemeContext.Provider>;
}
