/**
 * Regression tests for how the app picks the backend address.
 *
 * The bug: every loopback URL was rewritten to 10.0.2.2 on Android. That alias
 * only exists inside the Android emulator, so on a physical phone registration
 * and login could never reach the Mac's backend even though Metro was working
 * (Metro is reached at the LAN address, not via 10.0.2.2).
 *
 * These tests pin the resolution table without opening a socket, and they pin
 * the honest warning that is shown when an address cannot work from a phone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiBaseUrl: 'http://localhost:4001' } } },
}));

// In-memory SecureStore so getApiTarget can read the (absent) override.
const secure = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.delete(key);
  },
}));

import {
  ANDROID_EMULATOR_HOST,
  getApiTarget,
  resolveApiBaseUrl,
  type ApiResolutionContext,
} from '@/services/api';

const PHYSICAL_ANDROID: ApiResolutionContext = {
  platform: 'android',
  isPhysicalDevice: true,
  devServerHost: '192.168.1.20',
};
const EMULATOR: ApiResolutionContext = {
  platform: 'android',
  isPhysicalDevice: false,
  devServerHost: '192.168.1.20',
};
const PHYSICAL_IOS: ApiResolutionContext = {
  platform: 'ios',
  isPhysicalDevice: true,
  devServerHost: '192.168.1.20',
};

beforeEach(() => {
  secure.clear();
});

describe('Android emulator keeps the host alias', () => {
  it('maps localhost to 10.0.2.2 on an emulator', () => {
    expect(resolveApiBaseUrl('http://localhost:4001', EMULATOR)).toBe(
      `http://${ANDROID_EMULATOR_HOST}:4001`,
    );
  });

  it('maps 127.0.0.1 too, and keeps the port', () => {
    expect(resolveApiBaseUrl('http://127.0.0.1:4001', EMULATOR)).toBe(
      `http://${ANDROID_EMULATOR_HOST}:4001`,
    );
  });

  it('leaves 10.0.2.2 alone on an emulator', () => {
    expect(resolveApiBaseUrl(`http://${ANDROID_EMULATOR_HOST}:4001`, EMULATOR)).toBe(
      `http://${ANDROID_EMULATOR_HOST}:4001`,
    );
  });
});

describe('physical Android device (the reported failure)', () => {
  it('replaces loopback with the LAN host Metro is reachable at', () => {
    // Before the fix this returned http://10.0.2.2:4001 — a dead address on a
    // handset, which is exactly the "Cannot reach the VigilGrace backend" error.
    expect(resolveApiBaseUrl('http://localhost:4001', PHYSICAL_ANDROID)).toBe(
      'http://192.168.1.20:4001',
    );
  });

  it('never selects 10.0.2.2 on a physical device', () => {
    expect(resolveApiBaseUrl('http://localhost:4001', PHYSICAL_ANDROID)).not.toContain(
      ANDROID_EMULATOR_HOST,
    );
  });

  it('leaves an explicit LAN address untouched', () => {
    expect(resolveApiBaseUrl('http://192.168.1.50:4001', PHYSICAL_ANDROID)).toBe(
      'http://192.168.1.50:4001',
    );
  });

  it('leaves an HTTPS deployment untouched', () => {
    expect(resolveApiBaseUrl('https://api.vigilgrace.example', PHYSICAL_ANDROID)).toBe(
      'https://api.vigilgrace.example',
    );
  });

  it('keeps the configured backend port, not the Metro port', () => {
    expect(resolveApiBaseUrl('http://localhost:4001', PHYSICAL_ANDROID)).toMatch(/:4001$/);
  });

  it('does not invent an address when no dev server host is known', () => {
    const resolved = resolveApiBaseUrl('http://localhost:4001', {
      ...PHYSICAL_ANDROID,
      devServerHost: null,
    });
    expect(resolved).toBe('http://localhost:4001');
  });

  it('ignores a loopback dev server host', () => {
    const resolved = resolveApiBaseUrl('http://localhost:4001', {
      ...PHYSICAL_ANDROID,
      devServerHost: 'localhost',
    });
    expect(resolved).toBe('http://localhost:4001');
  });

  it('does not reuse a tunnel dev-server hostname for the backend', () => {
    // A tunnel only forwards Metro's port; the backend is not behind it.
    expect(
      resolveApiBaseUrl('http://localhost:4001', {
        ...PHYSICAL_ANDROID,
        devServerHost: 'abc123.anonymous.app.exp.direct',
      }),
    ).toBe('http://localhost:4001');
  });

  it('accepts an mDNS dev-server name', () => {
    expect(
      resolveApiBaseUrl('http://localhost:4001', {
        ...PHYSICAL_ANDROID,
        devServerHost: 'macbook-pro.local',
      }),
    ).toBe('http://macbook-pro.local:4001');
  });

  it('rewrites a saved 10.0.2.2 override to the LAN host', () => {
    // A Settings override from earlier emulator testing must not strand a phone.
    expect(resolveApiBaseUrl(`http://${ANDROID_EMULATOR_HOST}:4001`, PHYSICAL_ANDROID)).toBe(
      'http://192.168.1.20:4001',
    );
  });

  it('strips a trailing slash from the configured value', () => {
    expect(resolveApiBaseUrl('http://localhost:4001/', PHYSICAL_ANDROID)).toBe(
      'http://192.168.1.20:4001',
    );
  });
});

describe('iOS and web', () => {
  it('keeps localhost on the iOS simulator, where it is the host machine', () => {
    expect(
      resolveApiBaseUrl('http://localhost:4001', {
        platform: 'ios',
        isPhysicalDevice: false,
        devServerHost: '192.168.1.20',
      }),
    ).toBe('http://localhost:4001');
  });

  it('uses the LAN host on a physical iPhone', () => {
    expect(resolveApiBaseUrl('http://localhost:4001', PHYSICAL_IOS)).toBe(
      'http://192.168.1.20:4001',
    );
  });

  it('never rewrites the URL on web', () => {
    expect(
      resolveApiBaseUrl('http://localhost:4001', {
        platform: 'web',
        isPhysicalDevice: false,
        devServerHost: '192.168.1.20',
      }),
    ).toBe('http://localhost:4001');
  });
});

describe('diagnostics shown with the selected URL', () => {
  it('reports the resolved URL and its source', async () => {
    // No override in SecureStore, so the configured value is used. This Node
    // process has no Expo dev server, hence no LAN host to derive.
    const target = await getApiTarget();
    expect(target.source).toBe('config');
    expect(target.baseUrl).toBe('http://localhost:4001');
    expect(target.devServerHost).toBeNull();
  });

  it('honours a stored override', async () => {
    const { setApiBaseUrlOverride } = await import('@/services/api');
    await setApiBaseUrlOverride('http://192.168.1.77:4001');
    const target = await getApiTarget();
    expect(target.source).toBe('override');
    expect(target.baseUrl).toBe('http://192.168.1.77:4001');
  });

  it('warns honestly when a physical phone is pointed at its own loopback', async () => {
    const target = await getApiTarget();
    expect(target.baseUrl).toBe('http://localhost:4001');
    expect(target.warning).toMatch(/physical phone/i);
    expect(target.warning).toMatch(/LAN/);
  });

  it('warns about a saved emulator alias on a physical phone', async () => {
    const { setApiBaseUrlOverride } = await import('@/services/api');
    await setApiBaseUrlOverride(`http://${ANDROID_EMULATOR_HOST}:4001`);
    const target = await getApiTarget();
    expect(target.baseUrl).toBe(`http://${ANDROID_EMULATOR_HOST}:4001`);
    expect(target.warning).toMatch(/physical phone/i);
  });
});
