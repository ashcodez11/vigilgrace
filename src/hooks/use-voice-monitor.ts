/**
 * Voice distress monitoring hook (privacy-first).
 *
 * Streams mono PCM (float32, 16 kHz) via expo-audio's AudioStream, feeds it
 * to the pure AcousticDistressAnalyzer, and reports candidate distress events.
 * No audio is written to disk or uploaded by this hook — only scalar features
 * leave the analyzer. Automatic SOS is NOT fired from here; the caller decides
 * how to corroborate (config.requireCorroboration).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  onEventRef.current = onEvent;
  const [status, setStatus] = useState<VoiceMonitorStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<DistressEvent | null>(null);
  const [eventCount, setEventCount] = useState(0);

  const configKey = useMemo(() => JSON.stringify(config), [config]);

  useEffect(() => {
    analyzerRef.current.setConfig(config);
    // configKey is the stable identity of `config`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  const onBuffer = useRef((buffer: AudioStreamBuffer) => {
    const samples = new Float32Array(buffer.data);
    const evaluation = analyzerRef.current.analyze(samples, buffer.sampleRate, Date.now());
    if (evaluation.event) {
      setLastEvent(evaluation.event);
      setEventCount((n) => n + 1);
      onEventRef.current?.(evaluation.event);
    }
  }).current;

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
      try {
        stream.stop();
      } catch {
        // not started
      }
      setStatus('idle');
      return undefined;
    }

    setStatus('starting');
    setError(null);
    (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          if (!cancelled) {
            setStatus('denied');
            setError('Microphone permission denied');
          }
          return;
        }
        await stream.start();
        if (!cancelled) setStatus('running');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError((err as Error).message);
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

  return { status, error, lastEvent, eventCount };
}
