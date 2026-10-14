/**
 * OS permission helpers shared by profile + evidence flows.
 */

import { getRecordingPermissionsAsync } from 'expo-audio';

export interface SimplePermissionState {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

export async function checkMicrophonePermission(): Promise<SimplePermissionState> {
  const current = await getRecordingPermissionsAsync();
  return {
    granted: current.granted,
    canAskAgain: current.canAskAgain,
    status: current.status,
  };
}
