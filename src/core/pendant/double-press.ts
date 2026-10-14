/**
 * Pendant (ESP32 / BLE) integration logic — pure part.
 *
 * Contract with the external pendant firmware (see docs/security/pendant.md):
 *  - The pendant sends a "press" message on every button press.
 *  - Two presses inside a configurable window count as an SOS double press.
 *  - Before an emergency event is accepted the app challenges the pendant:
 *    app writes a random nonce, pendant replies with
 *    HMAC-SHA256(psk, nonce || deviceInfo). A valid MAC proves the pendant
 *    holds the pre-shared key provisioned during pairing (device auth).
 *
 * Status: algorithm implemented + unit tested. Requires BLE hardware,
 * firmware and a development build to run end to end — NOT hardware-tested.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { utf8Decode, utf8Encode } from '../crypto/bytes';

export interface DoublePressConfig {
  /** Max gap between press 1 and press 2 (ms). */
  windowMs: number;
  /** Ignore a second press closer than this to the first (contact bounce). */
  minSpacingMs: number;
  /** Quiet period after a completed double press. */
  cooldownMs: number;
}

export const DEFAULT_DOUBLE_PRESS_CONFIG: DoublePressConfig = {
  windowMs: 450,
  minSpacingMs: 60,
  cooldownMs: 5000,
};

export type PressResult = 'none' | 'first' | 'double';

export class DoublePressDetector {
  private firstAt: number | null = null;
  private cooldownUntil = -Infinity;

  constructor(private config: DoublePressConfig = DEFAULT_DOUBLE_PRESS_CONFIG) {}

  setConfig(config: DoublePressConfig): void {
    this.config = config;
    this.reset();
  }

  reset(): void {
    this.firstAt = null;
    this.cooldownUntil = -Infinity;
  }

  press(tMs: number): PressResult {
    const { windowMs, minSpacingMs, cooldownMs } = this.config;
    if (tMs < this.cooldownUntil) return 'none';

    if (this.firstAt === null) {
      this.firstAt = tMs;
      return 'first';
    }

    const gap = tMs - this.firstAt;
    if (gap < minSpacingMs) {
      // bounce — keep waiting from the original press
      return 'none';
    }
    if (gap <= windowMs) {
      this.firstAt = null;
      this.cooldownUntil = tMs + cooldownMs;
      return 'double';
    }
    // too slow: this press becomes the new first press
    this.firstAt = tMs;
    return 'first';
  }
}

/** Messages emitted by the pendant firmware. */
export type PendantMessage =
  | { type: 'press'; v: number; tMs: number }
  | { type: 'auth'; v: number; nonceHex: string; macHex: string; deviceId: string }
  | { type: 'hello'; v: number; deviceId: string; fw: string };

export function parsePendantMessage(raw: string): PendantMessage | null {
  try {
    const parsed = JSON.parse(raw) as PendantMessage;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') return null;
    if (parsed.type === 'press' && typeof parsed.tMs === 'number') return parsed;
    if (parsed.type === 'auth' && typeof parsed.nonceHex === 'string' && typeof parsed.macHex === 'string') {
      return parsed;
    }
    if (parsed.type === 'hello' && typeof parsed.deviceId === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

export function computePendantMac(psk: Uint8Array, nonceHex: string, deviceId: string): string {
  const mac = hmac(sha256, psk, utf8Encode(`${nonceHex}|${deviceId}`));
  return Array.from(mac)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function verifyPendantAuth(
  psk: Uint8Array,
  nonceHex: string,
  deviceId: string,
  macHex: string,
): boolean {
  const expected = computePendantMac(psk, nonceHex, deviceId);
  if (expected.length !== macHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ macHex.charCodeAt(i);
  }
  return diff === 0;
}

export function newPendantNonce(random: (len: number) => Uint8Array): string {
  const bytes = random(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { utf8Decode, utf8Encode };
