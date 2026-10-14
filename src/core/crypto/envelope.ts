/**
 * Sealed emergency-alert envelope.
 *
 * Pipeline (correct separation of cryptographic roles):
 *   payload --AES-256-GCM--> ciphertext      (message confidentiality)
 *   shared secret --HKDF-SHA-256--> AEAD key (key derivation from ML-KEM output)
 *   ML-KEM-768 encapsulation --------------> transport of the shared secret
 *   ML-DSA-65 signature --------------------> authenticity + integrity
 *   SHA-256 payload hash ------------------> evidence integrity / audit
 *
 * The envelope is transport-agnostic JSON (base64 binary fields) so it can be
 * POSTed over HTTPS to the backend, which decapsulates with its private
 * ML-KEM key, verifies the ML-DSA signature against the user's registered
 * public key, decrypts, and checks the payload hash.
 */

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

import { type RandomSource, fromBase64, toBase64, utf8Decode, utf8Encode } from './bytes';
import {
  KEM_ALGORITHM,
  SIGNATURE_ALGORITHM,
  SYMMETRIC_ALGORITHM,
  CONTENT_HASH_ALGORITHM,
  type AeadKey,
  type SignatureKeyPair,
  aeadDecrypt,
  aeadEncrypt,
  decapsulate,
  deriveAeadKey,
  encapsulate,
  hashBytes,
  sign,
  verify,
} from './pqc';
import type { EmergencyAlertPayload } from '../types';

export const ENVELOPE_VERSION = 1;

export interface SealedEnvelope {
  v: number;
  alertId: string;
  kem: typeof KEM_ALGORITHM;
  sigAlg: typeof SIGNATURE_ALGORITHM;
  aead: typeof SYMMETRIC_ALGORITHM;
  hashAlg: typeof CONTENT_HASH_ALGORITHM;
  kemCipherTextB64: string;
  nonceB64: string;
  ctB64: string;
  sigB64: string;
  signerPubB64: string;
  payloadHashB64: string;
}

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function signingInput(env: Omit<SealedEnvelope, 'sigB64'>): Uint8Array {
  return utf8Encode(
    [
      env.v,
      env.alertId,
      env.kem,
      env.sigAlg,
      env.aead,
      env.hashAlg,
      env.kemCipherTextB64,
      env.nonceB64,
      env.ctB64,
      env.signerPubB64,
      env.payloadHashB64,
    ].join('|'),
  );
}

function aadFor(alertId: string): Uint8Array {
  return utf8Encode(`vigilgrace/sos/envelope/v${ENVELOPE_VERSION}|${alertId}`);
}

export interface SealOptions {
  payload: EmergencyAlertPayload;
  serverKemPublicKey: Uint8Array;
  signer: SignatureKeyPair;
  random: RandomSource;
}

export function sealAlertEnvelope(options: SealOptions): SealedEnvelope {
  const { payload, serverKemPublicKey, signer, random } = options;
  const plaintextBytes = utf8Encode(canonicalJson(payload));
  const { cipherText, sharedSecret } = encapsulate(serverKemPublicKey, random);
  const salt = hashBytes(serverKemPublicKey);
  const key: AeadKey = deriveAeadKey(sharedSecret, salt);
  const aad = aadFor(payload.alertId);
  const { nonce, ciphertext } = aeadEncrypt(key, plaintextBytes, aad, random);
  const payloadHash = hashBytes(plaintextBytes);

  const unsigned: Omit<SealedEnvelope, 'sigB64'> = {
    v: ENVELOPE_VERSION,
    alertId: payload.alertId,
    kem: KEM_ALGORITHM,
    sigAlg: SIGNATURE_ALGORITHM,
    aead: SYMMETRIC_ALGORITHM,
    hashAlg: CONTENT_HASH_ALGORITHM,
    kemCipherTextB64: toBase64(cipherText),
    nonceB64: toBase64(nonce),
    ctB64: toBase64(ciphertext),
    signerPubB64: toBase64(signer.publicKey),
    payloadHashB64: toBase64(payloadHash),
  };

  const signature = sign(signingInput(unsigned), signer.secretKey);
  return { ...unsigned, sigB64: toBase64(signature) };
}

export class EnvelopeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unsupported-version'
      | 'bad-signature'
      | 'kem-failure'
      | 'decrypt-failure'
      | 'payload-hash-mismatch'
      | 'malformed',
  ) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

/** Verify the ML-DSA signature. Caller must check signerPub against registration. */
export function verifyEnvelopeSignature(env: SealedEnvelope): boolean {
  try {
    const { sigB64, ...unsigned } = env;
    return verify(fromBase64(sigB64), signingInput(unsigned), fromBase64(env.signerPubB64));
  } catch {
    return false;
  }
}

export interface OpenedEnvelope {
  payload: EmergencyAlertPayload;
  payloadJson: string;
  payloadHashB64: string;
}

/**
 * Decapsulate + decrypt + verify payload hash.
 * Signature verification is separate (verifyEnvelopeSignature) because the
 * server must compare signerPub against the key registered for the user.
 */
export function openAlertEnvelope(env: SealedEnvelope, serverKemSecretKey: Uint8Array): OpenedEnvelope {
  if (env.v !== ENVELOPE_VERSION) {
    throw new EnvelopeError(`Unsupported envelope version ${env.v}`, 'unsupported-version');
  }
  if (env.kem !== KEM_ALGORITHM || env.aead !== SYMMETRIC_ALGORITHM) {
    throw new EnvelopeError('Unsupported algorithm identifiers', 'unsupported-version');
  }
  let sharedSecret: Uint8Array;
  try {
    sharedSecret = decapsulate(fromBase64(env.kemCipherTextB64), serverKemSecretKey);
  } catch (err) {
    throw new EnvelopeError(
      `ML-KEM decapsulation failed: ${(err as Error).message}`,
      'kem-failure',
    );
  }
  const serverKemPublic = ml_kem768.getPublicKey(serverKemSecretKey);
  const salt = hashBytes(serverKemPublic);
  const key = deriveAeadKey(sharedSecret, salt);
  let plaintextBytes: Uint8Array;
  try {
    plaintextBytes = aeadDecrypt(
      key,
      fromBase64(env.nonceB64),
      fromBase64(env.ctB64),
      aadFor(env.alertId),
    );
  } catch (err) {
    throw new EnvelopeError(
      `AES-256-GCM decryption failed: ${(err as Error).message}`,
      'decrypt-failure',
    );
  }
  const payloadHash = hashBytes(plaintextBytes);
  if (toBase64(payloadHash) !== env.payloadHashB64) {
    throw new EnvelopeError('Payload hash mismatch', 'payload-hash-mismatch');
  }
  let payloadJson: string;
  try {
    payloadJson = utf8Decode(plaintextBytes);
    const payload = JSON.parse(payloadJson) as EmergencyAlertPayload;
    if (!payload || payload.alertId !== env.alertId) {
      throw new Error('alertId mismatch inside payload');
    }
    return { payload, payloadJson, payloadHashB64: env.payloadHashB64 };
  } catch (err) {
    if (err instanceof EnvelopeError) throw err;
    throw new EnvelopeError(`Malformed payload: ${(err as Error).message}`, 'malformed');
  }
}

/**
 * Recover the ML-KEM public key embedded in a FIPS 203 secret key.
 * noble exposes this via ml_kem768.getPublicKey.
 */
export function kemPublicKeyFromSecretKey(secretKey: Uint8Array): Uint8Array {
  return ml_kem768.getPublicKey(secretKey);
}

export function isSealedEnvelope(value: unknown): value is SealedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const env = value as Record<string, unknown>;
  return (
    typeof env.alertId === 'string' &&
    typeof env.kemCipherTextB64 === 'string' &&
    typeof env.nonceB64 === 'string' &&
    typeof env.ctB64 === 'string' &&
    typeof env.sigB64 === 'string' &&
    typeof env.signerPubB64 === 'string' &&
    typeof env.payloadHashB64 === 'string'
  );
}
