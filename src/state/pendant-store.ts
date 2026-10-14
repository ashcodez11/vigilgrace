/**
 * Pendant (BLE) store — device status, pairing PSK, scan/connect lifecycle.
 *
 * The pre-shared key is generated on the phone, stored in SecureStore, and
 * must be flashed onto the ESP32 during pairing (see docs/security/pendant.md).
 * It never appears in logs or public sources.
 */

import { create } from 'zustand';

import { fromBase64, toBase64 } from '@/core/crypto/bytes';
import {
  BlePendantService,
  type DiscoveredPendant,
  type PendantStatus,
} from '@/services/ble-pendant';
import { cryptoRandom } from '@/services/random';
import { deleteSecureItem, getSecureItem, setSecureItem } from '@/services/secure-store';

const PSK_KEY = 'pendant_psk';
const DEVICE_KEY = 'pendant_device_id';

interface PendantStoreState {
  status: PendantStatus;
  error: string | null;
  devices: DiscoveredPendant[];
  scanning: boolean;
  connectedDeviceId: string | null;
  hasPsk: boolean;
  lastDoublePressAt: number | null;
  service: BlePendantService | null;

  initService: () => Promise<void>;
  scan: () => Promise<void>;
  connect: (deviceId: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  /** Generate a fresh PSK for provisioning (returns base64 to flash on the pendant). */
  provisionPsk: () => Promise<string>;
  loadPskB64: () => Promise<string | null>;
  clearPendant: () => Promise<void>;
}

export const usePendantStore = create<PendantStoreState>((set, get) => ({
  status: 'idle',
  error: null,
  devices: [],
  scanning: false,
  connectedDeviceId: null,
  hasPsk: false,
  lastDoublePressAt: null,
  service: null,

  initService: async () => {
    if (get().service) return;
    const service = new BlePendantService({
      onStatusChange: (status, error, info) =>
        set({
          status,
          error,
          connectedDeviceId: info?.authenticated ? info.deviceId : get().connectedDeviceId,
          hasPsk: get().hasPsk,
        }),
      onDoublePress: () => set({ lastDoublePressAt: Date.now() }),
    });
    const psk = await getSecureItem(PSK_KEY);
    set({ service, hasPsk: psk !== null });
    await service.init();
    set({ status: service.getStatus().status, error: service.getStatus().error });
  },

  scan: async () => {
    set({ scanning: true, error: null });
    const service = get().service;
    if (!service) {
      set({ scanning: false, error: 'Bluetooth service not initialized' });
      return;
    }
    const devices = await service.scan(15000);
    set({ devices, scanning: false, status: service.getStatus().status });
  },

  connect: async (deviceId) => {
    const service = get().service;
    if (!service) return false;
    const pskB64 = await getSecureItem(PSK_KEY);
    if (!pskB64) {
      set({ error: 'No pendant key provisioned yet — generate one first' });
      return false;
    }
    const status = await service.connect(deviceId, fromBase64(pskB64));
    await setSecureItem(DEVICE_KEY, deviceId);
    set({ status, error: service.getStatus().error, connectedDeviceId: deviceId });
    return status === 'authenticated';
  },

  disconnect: async () => {
    await get().service?.disconnect();
    set({ status: 'idle', connectedDeviceId: null });
  },

  provisionPsk: async () => {
    const psk = cryptoRandom(32);
    await setSecureItem(PSK_KEY, toBase64(psk));
    set({ hasPsk: true });
    return toBase64(psk);
  },

  loadPskB64: async () => getSecureItem(PSK_KEY),

  clearPendant: async () => {
    await get().service?.disconnect();
    await deleteSecureItem(PSK_KEY);
    await deleteSecureItem(DEVICE_KEY);
    set({ hasPsk: false, connectedDeviceId: null, status: 'idle' });
  },
}));
