/**
 * SOS orchestration store: binds the pure SosMachine to real services.
 *
 * Guarantees:
 *  - a single alertId per emergency across all retries (server de-duplicates)
 *  - "delivered" is only set from backend-confirmed delivery reports
 *  - optional countdown with cancel / send-now
 *
 * Evidence audio is handled by the use-sos-controller hook: it records during
 * the countdown, then attaches hashed metadata to the accepted alert via the
 * backend's evidence endpoint (audio bytes stay on-device).
 */

import { create } from 'zustand';

import { SosMachine, type SosState } from '@/core/sos/sos-machine';
import type { SosTriggerSource } from '@/core/types';
import { notify } from '@/services/notifications';
import { dispatchSos, generateAlertId } from '@/services/sos-service';
import { useSettingsStore } from './settings-store';

const realScheduler = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const IDLE_STATE: SosState = {
  status: 'idle',
  source: null,
  alertId: null,
  countdownEndsAt: null,
  attempt: 0,
  lastError: null,
  report: null,
  updatedAt: 0,
};

interface SosStoreState {
  state: SosState;
  machine: SosMachine | null;

  init: () => void;
  trigger: (source: SosTriggerSource) => void;
  cancel: () => void;
  confirmNow: () => void;
  retry: () => void;
  reset: () => void;
}

function describeOutcome(state: SosState): { title: string; body: string } | null {
  switch (state.status) {
    case 'countdown':
      return { title: 'SOS countdown started', body: 'Tap CANCEL if this was accidental.' };
    case 'delivered': {
      const mock = state.report?.deliveryMode === 'mock';
      const count =
        state.report?.results.filter((r) => ['delivered', 'simulated', 'sent'].includes(r.state))
          .length ?? 0;
      return mock
        ? {
            title: 'SOS accepted — delivery SIMULATED',
            body: `The backend recorded the emergency and simulated delivery to ${count} contact(s). Mock mode: no real SMS or calls were made.`,
          }
        : { title: 'SOS delivered', body: `Delivery confirmed for ${count} contact(s).` };
    }
    case 'failed':
      return {
        title: 'SOS FAILED',
        body: state.lastError ?? 'The alert could not be delivered. Retry from the dashboard.',
      };
    default:
      return null;
  }
}

export const useSosStore = create<SosStoreState>((set, get) => ({
  state: IDLE_STATE,
  machine: null,

  init: () => {
    if (get().machine) return;
    const machine = new SosMachine({
      scheduler: realScheduler,
      countdownMs: useSettingsStore.getState().countdownSeconds * 1000,
      dispatch: (alertId, attempt, source) =>
        dispatchSos({ alertId, source, signals: { attempt } }),
      generateId: generateAlertId,
      onUpdate: (state) => {
        set({ state });
        const message = describeOutcome(state);
        if (message) {
          void notify(message.title, message.body, { data: { alertId: state.alertId } });
        }
      },
    });
    set({ machine });
  },

  trigger: (source) => {
    get().init();
    get().machine?.trigger(source);
  },

  cancel: () => get().machine?.cancel(),
  confirmNow: () => get().machine?.confirmNow(),
  retry: () => get().machine?.retryNow(),

  reset: () => {
    get().machine?.reset();
  },
}));
