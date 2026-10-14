import type { ConfigContext, ExpoConfig } from 'expo/config';
import fs from 'node:fs';
import path from 'node:path';

type LocalContactSeed = { name: string; phone: string; relation?: string };
type LocalConfig = {
  apiBaseUrl?: string;
  initialContacts?: LocalContactSeed[];
};

function loadLocalConfig(): LocalConfig {
  const file = path.join(__dirname, 'config', 'local.config.json');
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as LocalConfig;
    }
  } catch {
    // fall through to env/example defaults
  }
  return {};
}

function loadEnvContacts(): LocalContactSeed[] | undefined {
  const raw = process.env.EXPO_PUBLIC_INITIAL_CONTACTS;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as LocalContactSeed[];
  } catch {
    // ignore malformed env
  }
  return undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const local = loadLocalConfig();
  const initialContacts = loadEnvContacts() ?? local.initialContacts ?? [];
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_URL ??
    local.apiBaseUrl ??
    'http://localhost:4001';

  return {
    ...config,
    name: 'VigilGrace',
    slug: 'vigilgrace',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'vigilgrace',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.vigilgrace.safety',
      infoPlist: {
        NSBluetoothAlwaysUsageDescription:
          'VigilGrace uses Bluetooth to connect to your safety pendant.',
        NSMotionUsageDescription:
          'VigilGrace uses motion sensors for the optional shake-to-SOS trigger.',
        NSLocationWhenInUseUsageDescription:
          'VigilGrace uses your location so emergency contacts can find you.',
        NSMicrophoneUsageDescription:
          'VigilGrace listens for acoustic distress signals when you enable voice monitoring. Audio is analyzed on-device and never uploaded without your consent.',
      },
    },
    android: {
      package: 'com.vigilgrace.safety',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'ACTIVITY_RECOGNITION',
        'RECORD_AUDIO',
        'POST_NOTIFICATIONS',
        'VIBRATE',
        'BLUETOOTH_SCAN',
        'BLUETOOTH_CONNECT',
      ],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'VigilGrace uses your location so emergency contacts can find you during an SOS.',
        },
      ],
      [
        'expo-audio',
        {
          microphonePermission:
            'VigilGrace listens for acoustic distress signals when you enable voice monitoring. Audio stays on-device.',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/icon.png',
          color: '#B3261E',
        },
      ],
      'react-native-ble-plx',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#208AEF',
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      apiBaseUrl,
      initialContacts,
      router: {
        origin: false,
      },
      eas: {
        projectId: process.env.EAS_PROJECT_ID ?? '1fa56664-0cf2-4ff6-85ef-7aa798ad1cc9',
      },
    },
  };
};
