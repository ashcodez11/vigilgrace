/**
 * Post-quantum cryptography primitives.
 *
 * Roles are deliberately separated (FIPS 203 / FIPS 204):
 *  - ML-KEM-768 (Kyber):  key encapsulation only. It establishes a shared
 *    secret between two endpoints; it does NOT encrypt emergency messages.
 *  - AES-256-GCM:         authenticated encryption of the actual payload,
 *    with a key derived from the ML-KEM shared secret via HKDF-SHA-256 and a
 *    unique random 96-bit nonce per message.
 *  - ML-DSA-65 (Dilithium): digital signatures over the envelope. It does NOT
 *    encrypt anything; it proves the sender's identity / integrity.
 *  - SHA-256:             content hashing for evidence + envelope integrity.
 *
 * All randomness is injected (RandomSource) so the same code runs on
 * Hermes (expo-crypto), in Node tests, and in the backend.
 * Implementation: @noble/post-quantum, @noble/ciphers, @noble/hashes
 * (audited, pure TS, no custom cryptography here).
 */

import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

import { type RandomSource, bytesEqual, utf8Decode, utf8Encode } from './bytes';

export const KEM_ALGORITHM = 'ml-kem-768' as const;
export const SIGNATURE_ALGORITHM = 'ml-dsa-65' as const;
export const CONTENT_HASH_ALGORITHM = 'sha-256' as const;
export const SYMMETRIC_ALGORITHM = 'aes-256-gcm' as const;

export const NONCE_BYTES = 12;
export const KEY_BYTES = 32;
export const HKDF_INFO = utf8Encode('vigilgrace/sos/v1');

export interface KemKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface SignatureKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateKemKeyPair(random: RandomSource): KemKeyPair {
  const seed = random(ml_kem768.lengths.seed!);
  const { publicKey, secretKey } = ml_kem768.keygen(seed);
  return { publicKey, secretKey };
}

export function generateSignatureKeyPair(random: RandomSource): SignatureKeyPair {
  const seed = random(ml_dsa65.lengths.seed!);
  const { publicKey, secretKey } = ml_dsa65.keygen(seed);
  return { publicKey, secretKey };
}

export interface Encapsulation {
  cipherText: Uint8Array;
  sharedSecret: Uint8Array;
}

export function encapsulate(
  peerKemPublicKey: Uint8Array,
  random: RandomSource,
): Encapsulation {
  const msgRand = random(ml_kem768.lengths.msgRand!);
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(peerKemPublicKey, msgRand);
  return { cipherText, sharedSecret };
}

export function decapsulate(
  cipherText: Uint8Array,
  ownKemSecretKey: Uint8Array,
): Uint8Array {
  return ml_kem768.decapsulate(cipherText, ownKemSecretKey);
}

export type AeadKey = Uint8Array;

export function deriveAeadKey(sharedSecret: Uint8Array, salt: Uint8Array): AeadKey {
  return hkdf(sha256, sharedSecret, salt, HKDF_INFO, KEY_BYTES);
}

export interface AeadResult {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export function aeadEncrypt(
  key: AeadKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
  random: RandomSource,
): AeadResult {
  const nonce = random(NONCE_BYTES);
  const ciphertext = gcm(key, nonce, aad).encrypt(plaintext);
  return { nonce, ciphertext };
}

export function aeadDecrypt(
  key: AeadKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return gcm(key, nonce, aad).decrypt(ciphertext);
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_dsa65.sign(message, secretKey);
}

export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ml_dsa65.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function hashBytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function hashHex(data: Uint8Array): string {
  return Array.from(sha256(data))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hashHexOfString(text: string): string {
  return hashHex(utf8Encode(text));
}

export { bytesEqual, utf8Decode, utf8Encode };
