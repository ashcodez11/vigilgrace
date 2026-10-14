/**
 * Optional, consent-gated evidence audio recording.
 *
 * Records a SHORT clip (max 30 s) into the app's cache directory, computes a
 * SHA-256 digest of the bytes locally, and returns metadata. Raw audio is
 * never uploaded anywhere in this build — only the metadata + hash can be
 * attached to the emergency record (uploaded: false).
 */

import { useCallback, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';

export interface EvidenceClip {
  localUri: string;
  bytes: Uint8Array;
  sizeBytes: number;
}

export function useEvidenceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone permission denied — evidence recording skipped');
        return false;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 30 });
      setRecording(true);
      return true;
    } catch (err) {
      setError((err as Error).message);
      setRecording(false);
      return false;
    }
  }, [recorder]);

  const stop = useCallback(async (): Promise<EvidenceClip | null> => {
    if (!recording) return null;
    try {
      await recorder.stop();
    } catch (err) {
      setError((err as Error).message);
      setRecording(false);
      return null;
    }
    setRecording(false);
    const uri = recorder.uri;
    if (!uri) return null;
    try {
      const file = new File(uri);
      const bytes = file.bytesSync();
      return { localUri: uri, bytes, sizeBytes: bytes.length };
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [recorder, recording]);

  return { recording, error, start, stop };
}
