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

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

const IS_WEB = Platform.OS === 'web';

/**
 * Expo Go (StoreClient) on Android SDK 53+ no longer ships expo-notifications
 * support, and merely importing the package there errors. It is therefore
 * loaded lazily and never evaluated in Expo Go. Dev and production builds
 * (bare / standalone) are unaffected.
 */
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const UNSUPPORTED = IS_WEB || (IS_EXPO_GO && Platform.OS === 'android');

let cached: NotificationsModule | null | undefined;
let warned = false;

function getNotifications(): NotificationsModule | null {
  if (UNSUPPORTED) {
    if (__DEV__ && !warned && !IS_WEB) {
      warned = true;
      console.warn(
        '[VigilGrace] Notifications disabled: expo-notifications is unavailable in Expo Go on Android. ' +
          'Use a development build to test them. SOS alerts are unaffected.',
      );
    }
    return null;
  }
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications') as NotificationsModule;
    try {
      mod.setNotificationHandler({
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
    cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

const ANDROID_CHANNEL_ID = 'sos';
let androidChannelReady = false;

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || androidChannelReady) return;
  const Notifications = getNotifications();
  if (!Notifications) return;
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
  const Notifications = getNotifications();
  if (!Notifications) return false;
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
  const Notifications = getNotifications();
  if (!Notifications) return;
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
