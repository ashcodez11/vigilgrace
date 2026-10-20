/**
 * Server-side counterpart of the app's sealed emergency-alert envelope
 * (src/core/crypto/envelope.ts).
 *
 * The app seals an alert as:
 *   payload --AES-256-GCM--> ciphertext
 *   AES key  = HKDF-SHA-256(ML-KEM-768 shared secret, salt = SHA-256(server KEM public key))
 *   ML-DSA-65 signature over the envelope's own fields
 *
 * The server must therefore: verify the ML-DSA signature (against the key
 * registered for the calling user — never against an unverified self-declared
 * key), decapsulate with its ML-KEM-768 secret key, derive the same AES key,
 * decrypt with the same AAD, and check the SHA-256 payload digest.
 *
 * This mirrors the app's implementation exactly (same algorithm identifiers,
 * same signing input, same HKDF info/salt, same AAD). Any divergence breaks
 * decryption loudly instead of silently — that is the point.
 *
 * Implementation: @noble/post-quantum, @noble/ciphers, @noble/hashes — the same
 * audited, pure-JS libraries the app uses. No cryptography is invented here.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

export const ENVELOPE_VERSION = 1;
export const KEM_ALGORITHM = 'ml-kem-768';
export const SIGNATURE_ALGORITHM = 'ml-dsa-65';
export const SYMMETRIC_ALGORITHM = 'aes-256-gcm';
export const CONTENT_HASH_ALGORITHM = 'sha-256';

const HKDF_INFO = new TextEncoder().encode('vigilgrace/sos/v1');
const KEY_BYTES = 32;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const utf8Encode = (text) => new TextEncoder().encode(text);
const utf8Decode = (bytes) => new TextDecoder().decode(bytes);

export class EnvelopeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'EnvelopeError';
    this.code = code;
  }
}

/** Strict base64 decode: rejects anything that is not canonical base64. */
export function fromBase64Strict(value, field = 'field') {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    throw new EnvelopeError(`Malformed base64 in ${field}`, 'malformed');
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  return bytes;
}

/**
 * Structural check for the fields the server needs. Kept deliberately narrow:
 * a bad shape must be rejected before any crypto runs.
 */
export function isSealedEnvelope(value) {
  if (!value || typeof value !== 'object') return false;
  const env = value;
  return (
    typeof env.alertId === 'string' &&
    env.alertId.length > 0 &&
    env.alertId.length <= 128 &&
    typeof env.kemCipherTextB64 === 'string' &&
    typeof env.nonceB64 === 'string' &&
    typeof env.ctB64 === 'string' &&
    typeof env.sigB64 === 'string' &&
    typeof env.signerPubB64 === 'string' &&
    typeof env.payloadHashB64 === 'string'
  );
}

/** Must match the app byte-for-byte: values joined with '|' in this order. */
function signingInput(env) {
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

function aadFor(alertId) {
  return utf8Encode(`vigilgrace/sos/envelope/v${ENVELOPE_VERSION}|${alertId}`);
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

/** Verify the ML-DSA-65 signature. Caller must bind signerPub to a user key. */
export function verifyEnvelopeSignature(env) {
  try {
    const { sigB64, ...unsigned } = env;
    return ml_dsa65.verify(
      fromBase64Strict(sigB64, 'sigB64'),
      signingInput(unsigned),
      fromBase64Strict(env.signerPubB64, 'signerPubB64'),
    );
  } catch {
    return false;
  }
}

export function kemPublicKeyFromSecretKey(secretKey) {
  return ml_kem768.getPublicKey(secretKey);
}

/**
 * Decapsulate + decrypt + verify the payload digest.
 *
 * Signature verification is intentionally NOT done here: the caller must first
 * check the signature AND that signerPub is the key registered for the user.
 */
export function openAlertEnvelope(env, serverKemSecretKey) {
  if (env.v !== ENVELOPE_VERSION) {
    throw new EnvelopeError(`Unsupported envelope version ${env.v}`, 'unsupported-version');
  }
  if (env.kem !== KEM_ALGORITHM || env.aead !== SYMMETRIC_ALGORITHM) {
    throw new EnvelopeError('Unsupported algorithm identifiers', 'unsupported-version');
  }

  let sharedSecret;
  try {
    sharedSecret = ml_kem768.decapsulate(
      fromBase64Strict(env.kemCipherTextB64, 'kemCipherTextB64'),
      serverKemSecretKey,
    );
  } catch (err) {
    throw new EnvelopeError(`ML-KEM decapsulation failed: ${err.message}`, 'kem-failure');
  }

  const salt = sha256(kemPublicKeyFromSecretKey(serverKemSecretKey));
  const key = hkdf(sha256, sharedSecret, salt, HKDF_INFO, KEY_BYTES);

  let plaintextBytes;
  try {
    plaintextBytes = gcm(key, fromBase64Strict(env.nonceB64, 'nonceB64'), aadFor(env.alertId)).decrypt(
      fromBase64Strict(env.ctB64, 'ctB64'),
    );
  } catch (err) {
    throw new EnvelopeError(`AES-256-GCM decryption failed: ${err.message}`, 'decrypt-failure');
  }

  if (toBase64(sha256(plaintextBytes)) !== env.payloadHashB64) {
    throw new EnvelopeError('Payload hash mismatch', 'payload-hash-mismatch');
  }

  let payload;
  try {
    payload = JSON.parse(utf8Decode(plaintextBytes));
  } catch (err) {
    throw new EnvelopeError(`Malformed payload: ${err.message}`, 'malformed');
  }
  if (!payload || typeof payload !== 'object' || payload.alertId !== env.alertId) {
    throw new EnvelopeError('alertId mismatch inside payload', 'malformed');
  }
  return { payload, payloadHashB64: env.payloadHashB64 };
}

export { sha256, utf8Encode, utf8Decode, toBase64 };
