/**
 * SOS controller hook: countdown UI state, evidence recording consent flow,
 * post-delivery evidence metadata sync and history refresh.
 */

import { useCallback, useEffect, useRef } from 'react';

import type { SosTriggerSource } from '@/core/types';
import { attachEvidence } from '@/services/backend';
import { audioEvidenceRecord } from '@/services/sos-service';
import { useAuthStore } from '@/state/auth-store';
import { useHistoryStore } from '@/state/history-store';
import { useSettingsStore } from '@/state/settings-store';
import { useSosStore } from '@/state/sos-store';
import { useEvidenceRecorder } from './use-evidence-recorder';

export function useSosController() {
  const state = useSosStore((s) => s.state);
  const init = useSosStore((s) => s.init);
  const triggerStore = useSosStore((s) => s.trigger);
  const cancelStore = useSosStore((s) => s.cancel);
  const confirmNow = useSosStore((s) => s.confirmNow);
  const retry = useSosStore((s) => s.retry);
  const reset = useSosStore((s) => s.reset);
  const recorder = useEvidenceRecorder();
  const evidenceConsent = useSettingsStore((s) => s.evidenceRecordingConsent);
  const token = useAuthStore((s) => s.token);
  const refreshHistory = useHistoryStore((s) => s.refresh);

  useEffect(() => {
    init();
  }, [init]);

  const statusRef = useRef(state.status);
  const alertIdRef = useRef(state.alertId);

  const trigger = useCallback(
    (source: SosTriggerSource) => {
      // Shake and voice can both fire while an alert is already running.
      // The state machine ignores those triggers, so the recorder must not be
      // restarted either: doing so aborted the clip already being captured and
      // could leave the evidence note stuck on screen.
      const current = useSosStore.getState().state.status;
      if (current === 'countdown' || current === 'sending' || current === 'retrying') return;
      if (evidenceConsent) {
        void recorder.start();
      }
      triggerStore(source);
    },
    [evidenceConsent, recorder, triggerStore],
  );

  const cancel = useCallback(() => {
    void recorder.stop();
    cancelStore();
  }, [cancelStore, recorder]);

  // When the run reaches a terminal state, stop any recording, attach hashed
  // evidence metadata (never the audio bytes) and refresh history.
  useEffect(() => {
    if (statusRef.current === state.status) {
      alertIdRef.current = state.alertId;
      return;
    }
    const previous = statusRef.current;
    statusRef.current = state.status;
    const alertId = state.alertId ?? alertIdRef.current;
    alertIdRef.current = state.alertId;

    const terminal = ['delivered', 'failed', 'cancelled'].includes(state.status);
    if (!terminal || previous === state.status) return;

    void (async () => {
      const clip = await recorder.stop();
      if (!clip) return;
      // Evidence belongs to any alert the backend actually recorded, including
      // one whose delivery failed: that is when a recording matters most.
      if (alertId && state.report && token) {
        const record = audioEvidenceRecord(clip.localUri, clip.bytes, clip.sizeBytes);
        try {
          await attachEvidence(token, alertId, [record]);
        } catch {
          // evidence sync is best-effort; the clip remains on-device
        }
      }
      if (token) void refreshHistory(token);
    })();
  }, [state.status, state.alertId, state.report, recorder, token, refreshHistory]);

  return { state, trigger, cancel, confirmNow, retry, reset, evidenceRecording: recorder.recording };
}
