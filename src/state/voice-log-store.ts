/**
 * In-memory log of acoustic distress candidate events (most recent first).
 * Used by the voice settings screen to show what the prototype detected.
 * Only scalar features are stored — never audio.
 */

import { create } from 'zustand';

import type { DistressEvent } from '@/core/voice/acoustic-analyzer';

export interface VoiceLogEntry extends DistressEvent {
  at: number;
}

interface VoiceLogState {
  entries: VoiceLogEntry[];
  push: (event: DistressEvent) => void;
  clear: () => void;
}

export const useVoiceLogStore = create<VoiceLogState>((set) => ({
  entries: [],
  push: (event) =>
    set((s) => ({ entries: [{ ...event, at: Date.now() }, ...s.entries].slice(0, 20) })),
  clear: () => set({ entries: [] }),
}));
