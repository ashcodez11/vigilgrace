/**
 * User-configurable monitoring + SOS settings (persisted to app-private JSON).
 * Privacy defaults: shake off, voice off, evidence recording off,
 * corroboration required for voice-triggered actions, 10 s SOS countdown.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  ACOUSTIC_PRESETS,
  DEFAULT_ACOUSTIC_CONFIG,
  type AcousticConfig,
  type VoiceSensitivity,
} from '@/core/voice/acoustic-analyzer';
import { SENSITIVITY_PRESETS, type ShakeSensitivity } from '@/core/motion/shake-detector';
import { jsonFileStorage } from '@/services/json-storage';
import type { ThemeId } from '@/ui/theme-context';

export interface SettingsState {
  /** SOS countdown before sending (seconds). 0 = send immediately. */
  countdownSeconds: number;
  shakeEnabled: boolean;
  shakeSensitivity: ShakeSensitivity;
  voiceEnabled: boolean;
  voiceSensitivity: VoiceSensitivity;
  voiceRequireCorroboration: boolean;
  voiceKeywords: string[];
  /** Record a consented short audio clip during SOS (metadata only leaves device). */
  evidenceRecordingConsent: boolean;
  themeId: ThemeId;

  setCountdownSeconds: (seconds: number) => void;
  setShakeEnabled: (enabled: boolean) => void;
  setShakeSensitivity: (sensitivity: ShakeSensitivity) => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setVoiceSensitivity: (sensitivity: VoiceSensitivity) => void;
  setVoiceRequireCorroboration: (required: boolean) => void;
  setVoiceKeywords: (keywords: string[]) => void;
  setEvidenceRecordingConsent: (consent: boolean) => void;
  setThemeId: (themeId: ThemeId) => void;

  /** Derived acoustic config for the analyzer. */
  acousticConfig: () => AcousticConfig;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      countdownSeconds: 10,
      shakeEnabled: false,
      shakeSensitivity: 'medium',
      voiceEnabled: false,
      voiceSensitivity: 'medium',
      voiceRequireCorroboration: true,
      voiceKeywords: DEFAULT_ACOUSTIC_CONFIG.keywords,
      evidenceRecordingConsent: false,
      themeId: 'gothic-noir',

      setCountdownSeconds: (seconds) =>
        set({ countdownSeconds: Math.max(0, Math.min(30, Math.round(seconds))) }),
      setShakeEnabled: (shakeEnabled) => set({ shakeEnabled }),
      setShakeSensitivity: (shakeSensitivity) => set({ shakeSensitivity }),
      setVoiceEnabled: (voiceEnabled) => set({ voiceEnabled }),
      setVoiceSensitivity: (voiceSensitivity) => set({ voiceSensitivity }),
      setVoiceRequireCorroboration: (voiceRequireCorroboration) => set({ voiceRequireCorroboration }),
      setVoiceKeywords: (voiceKeywords) => set({ voiceKeywords: voiceKeywords.slice(0, 20) }),
      setEvidenceRecordingConsent: (evidenceRecordingConsent) => set({ evidenceRecordingConsent }),
      setThemeId: (themeId) => set({ themeId }),

      acousticConfig: () => {
        const s = get();
        return {
          ...ACOUSTIC_PRESETS[s.voiceSensitivity],
          enabled: s.voiceEnabled,
          cooldownMs: DEFAULT_ACOUSTIC_CONFIG.cooldownMs,
          requireCorroboration: s.voiceRequireCorroboration,
          keywords: s.voiceKeywords,
        };
      },
    }),
    {
      name: 'vigilgrace_settings',
      storage: createJSONStorage(() => jsonFileStorage),
    },
  ),
);

export function shakeConfigForSensitivity(sensitivity: ShakeSensitivity) {
  return SENSITIVITY_PRESETS[sensitivity];
}
