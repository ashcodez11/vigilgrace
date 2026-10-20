/**
 * Local notifications for SOS status + monitoring alerts.
 * Remote push is intentionally not required for core safety flows (it needs a
 * dev build + EAS project id); local notifications work everywhere.
 *
 * STANCE: notifications are a convenience, never part of delivery. On web the
 * module methods do not exist, and on a device the user can deny permission or
 * the OS can reject a schedule call — none of that may break an emergency.
 * Every entry point here is therefore guarded and swallows failures, because
 * `void notify(...)` from the SOS machine would otherwise surface as an
 * unhandled rejection (a red screen on web, a crash report on a device).
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const IS_WEB = Platform.OS === 'web';

if (!IS_WEB) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Handler registration is best-effort.
  }
}

const ANDROID_CHANNEL_ID = 'sos';
let androidChannelReady = false;

async function ensureAndroidChannel(): Promise<void> {
  if (IS_WEB || Platform.OS !== 'android' || androidChannelReady) return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Emergency alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#B3261E',
    });
    androidChannelReady = true;
  } catch {
    // No channel: notifications degrade, the alert itself is unaffected.
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (IS_WEB) return false;
  try {
    await ensureAndroidChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

export interface NotifyOptions {
  data?: Record<string, unknown>;
}

export async function notify(title: string, body: string, options: NotifyOptions = {}): Promise<void> {
  if (IS_WEB) return;
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: options.data ?? {},
      },
      // Android requires a channel for high-priority delivery; a 1s interval
      // trigger is the SDK-supported way to attach one.
      trigger:
        Platform.OS === 'android'
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 1,
              channelId: ANDROID_CHANNEL_ID,
            }
          : null,
    });
  } catch {
    // Swallowed on purpose: see the module comment.
  }
}
