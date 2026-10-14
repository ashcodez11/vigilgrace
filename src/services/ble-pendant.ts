/**
 * External pendant integration (ESP32 + BLE), app side.
 *
 * BLE contract (firmware must implement the same UUIDs — see
 * docs/security/pendant.md):
 *   Service   5afe0001-0000-4000-8000-00005a1e9a11
 *   PRESS     notify  → {"v":1,"type":"press","tMs":<device ms>}
 *   AUTH_CHAL write   → utf8(nonceHex)                 (app → pendant)
 *   AUTH_RESP notify  → {"v":1,"type":"auth","nonceHex","macHex","deviceId"}
 *                       mac = HMAC-SHA256(psk, nonceHex|deviceId)
 *   INFO      read    → {"v":1,"type":"hello","deviceId","fw"}
 *
 * Two button presses inside a configurable window (DoublePressDetector) +
 * HMAC-authenticated device = validated emergency event.
 *
 * STATUS: application logic implemented and unit-tested. It requires
 * (a) a development build (react-native-ble-plx has native code; it does NOT
 * run inside Expo Go), (b) an ESP32 running matching firmware, (c) physical
 * hardware testing. This has NOT been verified against real hardware yet.
 */

import Constants from 'expo-constants';

import {
  DoublePressDetector,
  type DoublePressConfig,
  DEFAULT_DOUBLE_PRESS_CONFIG,
  computePendantMac,
  newPendantNonce,
  parsePendantMessage,
  verifyPendantAuth,
} from '@/core/pendant/double-press';
import { fromBase64, toBase64, utf8Decode, utf8Encode } from '@/core/crypto/bytes';

export const PENDANT_SERVICE_UUID = '5afe0001-0000-4000-8000-00005a1e9a11';
export const PENDANT_PRESS_CHAR_UUID = '5afe0002-0000-4000-8000-00005a1e9a11';
export const PENDANT_AUTH_CHALLENGE_CHAR_UUID = '5afe0003-0000-4000-8000-00005a1e9a11';
export const PENDANT_AUTH_RESPONSE_CHAR_UUID = '5afe0004-0000-4000-8000-00005a1e9a11';
export const PENDANT_INFO_CHAR_UUID = '5afe0005-0000-4000-8000-00005a1e9a11';

export type PendantStatus =
  | 'requires-dev-build'
  | 'unsupported'
  | 'powered-off'
  | 'unauthorized'
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'authenticated'
  | 'error';

export interface PendantDeviceInfo {
  deviceId: string;
  name: string | null;
  firmware?: string;
  authenticated: boolean;
}

export interface DiscoveredPendant {
  deviceId: string;
  name: string;
}

interface BleManagerLike {
  onStateChange: (cb: (state: string) => void, emitCurrent?: boolean) => { remove: () => void };
  startDeviceScan: (
    uuids: string[] | null,
    options: unknown,
    cb: (error: Error | null, device: BleDeviceLike | null) => void,
  ) => void;
  stopDeviceScan: () => void;
  monitorCharacteristicForDevice: (
    deviceId: string,
    service: string,
    characteristic: string,
    cb: (error: Error | null, characteristic: { value: string | null } | null) => void,
  ) => { remove: () => void };
  cancelDeviceConnection: (deviceId: string) => Promise<unknown>;
  destroy: () => Promise<void>;
}

interface BleDeviceLike {
  id: string;
  name: string | null;
  localName: string | null;
  connect: () => Promise<BleDeviceLike>;
  discoverAllServicesAndCharacteristics: () => Promise<BleDeviceLike>;
  writeCharacteristicWithResponseForService: (
    service: string,
    characteristic: string,
    valueBase64: string,
  ) => Promise<unknown>;
}

function isExpoGo(): boolean {
  return Constants.executionEnvironment === 'storeClient';
}

function loadBleModule(): { BleManager: new () => BleManagerLike } | null {
  if (isExpoGo()) return null;
  try {
    // Native module — absent in Expo Go / web, present in dev & production builds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-ble-plx');
  } catch {
    return null;
  }
}

export class BlePendantService {
  private manager: BleManagerLike | null = null;
  private device: BleDeviceLike | null = null;
  private subscriptions: Array<{ remove: () => void }> = [];
  private detector = new DoublePressDetector(DEFAULT_DOUBLE_PRESS_CONFIG);
  private status: PendantStatus = 'idle';
  private lastError: string | null = null;
  private info: PendantDeviceInfo | null = null;
  private deviceHandles = new Map<string, BleDeviceLike>();

  constructor(private readonly callbacks: {
    onStatusChange: (status: PendantStatus, error: string | null, info: PendantDeviceInfo | null) => void;
    onDoublePress: (info: PendantDeviceInfo) => void;
  }) {}

  getStatus(): { status: PendantStatus; error: string | null; info: PendantDeviceInfo | null } {
    return { status: this.status, error: this.lastError, info: this.info };
  }

  setDoublePressConfig(config: DoublePressConfig): void {
    this.detector.setConfig(config);
  }

  private setStatus(status: PendantStatus, error: string | null = null): void {
    this.status = status;
    this.lastError = error;
    this.callbacks.onStatusChange(status, error, this.info);
  }

  /** True when a native BLE stack is available (dev/production build). */
  isSupported(): boolean {
    return loadBleModule() !== null;
  }

  async init(): Promise<PendantStatus> {
    if (this.manager) return this.status;
    const ble = loadBleModule();
    if (!ble) {
      this.setStatus('requires-dev-build', 'Bluetooth requires a development/production build (not Expo Go)');
      return this.status;
    }
    try {
      this.manager = new ble.BleManager();
      await new Promise<void>((resolve) => {
        const sub = this.manager!.onStateChange((state) => {
          if (state === 'PoweredOn') {
            sub.remove();
            resolve();
          } else if (state === 'PoweredOff') {
            sub.remove();
            this.setStatus('powered-off', 'Bluetooth is off');
            resolve();
          } else if (state === 'Unauthorized') {
            sub.remove();
            this.setStatus('unauthorized', 'Bluetooth permission denied');
            resolve();
          }
        }, true);
        this.subscriptions.push(sub);
      });
      if (this.status === 'idle') this.setStatus('idle');
      return this.status;
    } catch (err) {
      this.setStatus('error', (err as Error).message);
      return this.status;
    }
  }

  /** Scan for pendant advertisements exposing our service UUID. */
  async scan(timeoutMs = 15000): Promise<DiscoveredPendant[]> {
    if (!this.manager) {
      await this.init();
      if (!this.manager) return [];
    }
    this.setStatus('scanning');
    const found = new Map<string, DiscoveredPendant>();

    return new Promise<DiscoveredPendant[]>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        try {
          this.manager?.stopDeviceScan();
        } catch {
          // ignore
        }
        if (this.status === 'scanning') this.setStatus('idle');
        resolve(Array.from(found.values()));
      };
      const timer = setTimeout(finish, timeoutMs);
      try {
        this.manager!.startDeviceScan([PENDANT_SERVICE_UUID], null, (error, device) => {
          if (error || !device) return;
          this.deviceHandles.set(device.id, device);
          if (!found.has(device.id)) {
            const name = device.name ?? device.localName ?? 'VigilGrace pendant';
            found.set(device.id, { deviceId: device.id, name });
          }
        });
      } catch (err) {
        this.lastError = (err as Error).message;
        finish();
      }
    });
  }

  /**
   * Connect + authenticate the pendant with its pre-shared key.
   * The PSK must be provisioned on the ESP32 at pairing time (flashed or
   * written over a secure provisioning channel) and stored in SecureStore here.
   */
  async connect(deviceId: string, psk: Uint8Array): Promise<PendantStatus> {
    if (!this.manager) {
      await this.init();
      if (!this.manager) return this.status;
    }
    this.setStatus('connecting');
    try {
      await this.disconnect();
      const discovered = await this.ensureDevice(deviceId);
      const connected = (await discovered.connect()) as BleDeviceLike;
      this.device = await connected.discoverAllServicesAndCharacteristics();
      this.setStatus('connected');

      // Read firmware info (best effort).
      let firmware: string | undefined;
      try {
        const infoChar = await this.readChar(deviceId, PENDANT_INFO_CHAR_UUID);
        if (infoChar) {
          const parsed = parsePendantMessage(utf8Decode(fromBase64(infoChar)));
          if (parsed?.type === 'hello') firmware = parsed.fw;
        }
      } catch {
        // optional characteristic
      }

      this.setStatus('authenticating');
      const authenticated = await this.authenticate(deviceId, psk);
      this.info = {
        deviceId,
        name: this.device.name ?? this.device.localName ?? discovered.name,
        firmware,
        authenticated,
      };
      if (!authenticated) {
        this.setStatus('error', 'Pendant authentication failed (PSK mismatch)');
        return this.status;
      }

      this.detector.reset();
      const pressSub = this.manager.monitorCharacteristicForDevice(
        deviceId,
        PENDANT_SERVICE_UUID,
        PENDANT_PRESS_CHAR_UUID,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
          const message = parsePendantMessage(utf8Decode(fromBase64(characteristic.value)));
          if (message?.type !== 'press') return;
          // Local receipt time keeps the window independent of device clocks.
          if (this.detector.press(Date.now()) === 'double' && this.info) {
            this.callbacks.onDoublePress(this.info);
          }
        },
      );
      this.subscriptions.push(pressSub);
      this.setStatus('authenticated');
      return this.status;
    } catch (err) {
      this.setStatus('error', (err as Error).message);
      return this.status;
    }
  }

  async disconnect(): Promise<void> {
    for (const sub of this.subscriptions.splice(0)) {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    }
    this.detector.reset();
    const device = this.device;
    this.device = null;
    this.info = null;
    if (device && this.manager) {
      try {
        await this.manager.cancelDeviceConnection(device.id);
      } catch {
        // ignore
      }
    }
    if (this.status !== 'requires-dev-build' && this.status !== 'unsupported') {
      this.setStatus('idle');
    }
  }

  async destroy(): Promise<void> {
    await this.disconnect();
    if (this.manager) {
      try {
        await this.manager.destroy();
      } catch {
        // ignore
      }
      this.manager = null;
    }
  }

  /** Resolve a device handle, scanning briefly if it is not known yet. */
  private async ensureDevice(deviceId: string): Promise<BleDeviceLike> {
    const known = this.deviceHandles.get(deviceId);
    if (known) return known;
    await this.scan(8000);
    const found = this.deviceHandles.get(deviceId);
    if (!found) throw new Error(`Pendant ${deviceId} not found during scan`);
    return found;
  }

  private async readChar(deviceId: string, characteristic: string): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mgr = this.manager as any;
    if (!mgr?.readCharacteristicForDevice) return null;
    const value = await mgr.readCharacteristicForDevice(
      deviceId,
      PENDANT_SERVICE_UUID,
      characteristic,
    );
    return value?.value ?? null;
  }

  /** Challenge-response: write nonce, verify HMAC reply, subscribe auth char first. */
  private authenticate(deviceId: string, psk: Uint8Array): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const nonceHex = newPendantNonce((n) => {
        const out = new Uint8Array(n);
        for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
        return out;
      });
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        authSub.remove();
        resolve(result);
      };

      const authSub = this.manager!.monitorCharacteristicForDevice(
        deviceId,
        PENDANT_SERVICE_UUID,
        PENDANT_AUTH_RESPONSE_CHAR_UUID,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
          const parsed = parsePendantMessage(utf8Decode(fromBase64(characteristic.value)));
          if (parsed?.type !== 'auth') return;
          finish(verifyPendantAuth(psk, parsed.nonceHex, parsed.deviceId, parsed.macHex));
        },
      );
      this.subscriptions.push(authSub);

      this.device
        ?.writeCharacteristicWithResponseForService(
          PENDANT_SERVICE_UUID,
          PENDANT_AUTH_CHALLENGE_CHAR_UUID,
          toBase64(utf8Encode(nonceHex)),
        )
        .catch((err: Error) => {
          if (!settled) {
            settled = true;
            authSub.remove();
            reject(err);
          }
        });

      setTimeout(() => finish(false), 8000);
    });
  }
}

export { computePendantMac };
