/**
 * Semantic tokens. Components consume these names only; each maps back to a
 * reference colour in palette.ts (see docs/DESIGN_SYSTEM.md).
 */
import { functional, palette as p } from './palette';

export interface SemanticTokens {
  bg: string;
  surface: string;
  surfaceElevated: string;
  surfaceSunken: string;
  textPrimary: string;
  textSecondary: string;
  textOnAccent: string;
  separator: string;
  borderStrong: string;
  accent: string; // primary actions
  accentPressed: string;
  accentSoft: string; // tinted backgrounds, selected rows
  emergency: string; // SOS only
  emergencyPressed: string;
  textOnEmergency: string;
  dangerText: string;
  success: string;
  warning: string;
  info: string;
  focusRing: string;
}

export const lightTokens: SemanticTokens = {
  bg: p.cloudWhite,
  surface: functional.white,
  surfaceElevated: functional.white,
  surfaceSunken: p.champagne,
  textPrimary: p.graphite,
  textSecondary: p.deepPlum,
  textOnAccent: p.cloudWhite,
  separator: p.roseBlush,
  borderStrong: p.mauveWood,
  accent: p.burgundy,
  accentPressed: p.mulberry,
  accentSoft: p.blushPink,
  emergency: functional.emergencyLight,
  emergencyPressed: p.blackCherry,
  textOnEmergency: functional.white,
  dangerText: functional.emergencyLight,
  success: functional.successLight,
  warning: functional.warningLight,
  info: p.deepPlum,
  focusRing: p.bronzedWine,
};

export const darkTokens: SemanticTokens = {
  bg: p.nearBlack,
  surface: functional.surfaceDark,
  surfaceElevated: p.blackCherryDark,
  surfaceSunken: '#14070D',
  textPrimary: p.champagne,
  textSecondary: p.roseBlush,
  textOnAccent: p.nearBlack,
  separator: '#4A2230',
  borderStrong: p.mauveWood,
  accent: p.roseGold,
  accentPressed: p.blushPetal,
  accentSoft: p.blackCherryDark,
  emergency: functional.emergencyDark,
  emergencyPressed: '#E0305C',
  textOnEmergency: functional.white,
  dangerText: functional.dangerTextDark,
  success: functional.successDark,
  warning: functional.warningDark,
  info: functional.infoDark,
  focusRing: p.roseBlush,
};
