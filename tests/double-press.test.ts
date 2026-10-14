import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOUBLE_PRESS_CONFIG,
  DoublePressDetector,
  computePendantMac,
  newPendantNonce,
  parsePendantMessage,
  verifyPendantAuth,
} from '@/core/pendant/double-press';

const random = (len: number) => new Uint8Array(len).fill(9);

describe('DoublePressDetector', () => {
  it('detects two presses inside the window', () => {
    const d = new DoublePressDetector();
    expect(d.press(0)).toBe('first');
    expect(d.press(300)).toBe('double');
  });

  it('ignores a single slow press (becomes a new first press)', () => {
    const d = new DoublePressDetector();
    expect(d.press(0)).toBe('first');
    expect(d.press(800)).toBe('first'); // window 450 ms exceeded
    expect(d.press(900)).toBe('double'); // 100 ms after the new first press
  });

  it('treats contact bounce (< minSpacingMs) as the same press', () => {
    const d = new DoublePressDetector();
    expect(d.press(0)).toBe('first');
    expect(d.press(20)).toBe('none'); // bounce ignored
    expect(d.press(300)).toBe('double'); // still counts from t=0
  });

  it('enforces cooldown after a completed double press', () => {
    const d = new DoublePressDetector();
    d.press(0);
    d.press(300);
    // immediately press twice again inside cooldown
    expect(d.press(400)).toBe('none');
    expect(d.press(700)).toBe('none');
    // after cooldown a new sequence starts
    expect(d.press(300 + DEFAULT_DOUBLE_PRESS_CONFIG.cooldownMs + 50)).toBe('first');
    expect(
      d.press(300 + DEFAULT_DOUBLE_PRESS_CONFIG.cooldownMs + 350),
    ).toBe('double');
  });

  it('supports configurable windows', () => {
    const d = new DoublePressDetector({ windowMs: 200, minSpacingMs: 50, cooldownMs: 1000 });
    d.press(0);
    expect(d.press(250)).toBe('first'); // outside the tighter window
    expect(d.press(400)).toBe('double');
  });
});

describe('pendant authentication (HMAC-SHA256 with pre-shared key)', () => {
  const psk = new Uint8Array(32).fill(7);

  it('accepts a valid MAC from a paired pendant', () => {
    const nonce = newPendantNonce(random);
    const mac = computePendantMac(psk, nonce, 'esp32-001');
    expect(verifyPendantAuth(psk, nonce, 'esp32-001', mac)).toBe(true);
  });

  it('rejects a wrong nonce, wrong device id or wrong key', () => {
    const nonce = newPendantNonce(random);
    const mac = computePendantMac(psk, nonce, 'esp32-001');
    expect(verifyPendantAuth(psk, 'deadbeef', 'esp32-001', mac)).toBe(false);
    expect(verifyPendantAuth(psk, nonce, 'esp32-002', mac)).toBe(false);
    expect(verifyPendantAuth(new Uint8Array(32).fill(8), nonce, 'esp32-001', mac)).toBe(false);
  });
});

describe('pendant message parsing', () => {
  it('parses valid messages', () => {
    expect(parsePendantMessage(JSON.stringify({ v: 1, type: 'press', tMs: 123 }))).toEqual({
      v: 1,
      type: 'press',
      tMs: 123,
    });
    expect(
      parsePendantMessage(JSON.stringify({ v: 1, type: 'hello', deviceId: 'd1', fw: '1.0' })),
    ).toMatchObject({ type: 'hello', deviceId: 'd1' });
  });

  it('rejects garbage and malformed messages', () => {
    expect(parsePendantMessage('not json')).toBeNull();
    expect(parsePendantMessage('[]')).toBeNull();
    expect(parsePendantMessage(JSON.stringify({ type: 'press' }))).toBeNull();
    expect(parsePendantMessage(JSON.stringify({ type: 'auth', nonceHex: 'aa' }))).toBeNull();
  });
});
