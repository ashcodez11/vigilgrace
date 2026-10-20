/**
 * Voice distress monitoring hook (privacy-first).
 *
 * Streams mono PCM (float32, 16 kHz) via expo-audio's AudioStream, feeds it
 * to the pure AcousticDistressAnalyzer, and reports candidate distress events.
 * No audio is written to disk or uploaded by this hook — only scalar features
 * leave the analyzer. Automatic SOS is NOT fired from here; the caller decides
 * how to corroborate (config.requireCorroboration).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  requestRecordingPermissionsAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from 'expo-audio';

import {
  AcousticDistressAnalyzer,
  type AcousticConfig,
  type DistressEvent,
} from '@/core/voice/acoustic-analyzer';

export type VoiceMonitorStatus = 'idle' | 'starting' | 'running' | 'denied' | 'error';

export interface VoiceMonitorResult {
  status: VoiceMonitorStatus;
  error: string | null;
  lastEvent: DistressEvent | null;
  eventCount: number;
}

export function useVoiceMonitor(
  config: AcousticConfig,
  onEvent?: (event: DistressEvent) => void,
): VoiceMonitorResult {
  const analyzerRef = useRef(new AcousticDistressAnalyzer(config));
  const onEventRef = useRef(onEvent);
  const [runtime, setRuntime] = useState<{ status: VoiceMonitorStatus; error: string | null }>({
    status: 'idle',
    error: null,
  });
  const [lastEvent, setLastEvent] = useState<DistressEvent | null>(null);
  const [eventCount, setEventCount] = useState(0);

  // Callback identity changes every render; keep the ref current from an effect
  // instead of writing it during render (React Compiler rejects that, and a
  // stale callback would push events into an unmounted screen's state).
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const configKey = useMemo(() => JSON.stringify(config), [config]);

  useEffect(() => {
    analyzerRef.current.setConfig(config);
    // configKey is the stable identity of `config`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // Stable across renders: rebuilding this callback on every render changed the
  // stream options object, which restarted the audio stream mid-monitoring.
  const onBuffer = useCallback((buffer: AudioStreamBuffer) => {
    const samples = new Float32Array(buffer.data);
    const evaluation = analyzerRef.current.analyze(samples, buffer.sampleRate, Date.now());
    if (evaluation.event) {
      setLastEvent(evaluation.event);
      setEventCount((n) => n + 1);
      onEventRef.current?.(evaluation.event);
    }
  }, []);

  const streamOptions = useMemo(
    () => ({
      sampleRate: 16000,
      channels: 1,
      encoding: 'float32' as const,
      onBuffer,
    }),
    [onBuffer],
  );

  const { stream } = useAudioStream(streamOptions);
  const enabled = config.enabled;

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      // Status is derived below while disabled, so no setState is needed here.
      try {
        stream.stop();
      } catch {
        // not started
      }
      return undefined;
    }

    void (async () => {
      setRuntime({ status: 'starting', error: null });
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          if (!cancelled) {
            setRuntime({ status: 'denied', error: 'Microphone permission denied' });
          }
          return;
        }
        await stream.start();
        if (!cancelled) setRuntime({ status: 'running', error: null });
      } catch (err) {
        if (!cancelled) {
          setRuntime({ status: 'error', error: (err as Error).message });
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        stream.stop();
      } catch {
        // ignore
      }
    };
  }, [enabled, stream]);

  return {
    status: enabled ? runtime.status : ('idle' as const),
    error: enabled ? runtime.error : null,
    lastEvent,
    eventCount,
  };
}
