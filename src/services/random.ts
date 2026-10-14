import * as Crypto from 'expo-crypto';

import type { RandomSource } from '@/core/crypto/bytes';

/**
 * Cryptographically secure randomness for the PQC layer.
 * expo-crypto backs this with the platform CSPRNG (SecRandom / /dev/urandom),
 * which also sidesteps Hermes' lack of globalThis.crypto.getRandomValues.
 */
export const cryptoRandom: RandomSource = (length: number) => Crypto.getRandomBytes(length);

export function randomHex(bytes: number): string {
  return Array.from(cryptoRandom(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function uuid(): string {
  return Crypto.randomUUID();
}
