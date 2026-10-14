/**
 * Emergency history (alerts) store.
 */

import { create } from 'zustand';

import type { AlertSummary } from '@/services/backend';
import { listAlerts } from '@/services/backend';

interface HistoryState {
  alerts: AlertSummary[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: string | null;

  refresh: (token: string) => Promise<void>;
  reset: () => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  alerts: [],
  loading: false,
  error: null,
  lastFetchedAt: null,

  refresh: async (token) => {
    set({ loading: true, error: null });
    try {
      const { alerts } = await listAlerts(token);
      set({ alerts, loading: false, lastFetchedAt: new Date().toISOString() });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  reset: () => set({ alerts: [], loading: false, error: null, lastFetchedAt: null }),
}));
