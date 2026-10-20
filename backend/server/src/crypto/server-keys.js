/**
 * Server post-quantum key material for sealed alert envelopes.
 *
 * Two options, in order of preference:
 *  1. `VIGILGRACE_SERVER_KEY_SEED` (hex ≥ 64 chars, or base64 ≥ 32 bytes) — the
 *     keypairs are derived deterministically from it, so they survive a wiped
 *     data directory and survive being deployed on ephemeral storage. The seed
 *     itself never appears in logs or API responses.
 *  2. First start without a seed: generate fresh keypairs with the OS CSPRNG and
 *     persist them in the (0600, gitignored) data file.
 *
 * Only the PUBLIC halves are ever returned by an HTTP route. The secret halves
 * are what let the server open sealed envelopes, so they are treated as
 * credentials: never logged, never returned, never committed.
 */

import { createHash, randomBytes } from 'node:crypto';

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

import { toBase64 } from './envelope.js';

const ALGORITHMS = Object.freeze({
  kem: 'ml-kem-768',
  signature: 'ml-dsa-65',
  aead: 'aes-256-gcm',
  hash: 'sha-256',
});

function seedFromEnv(env) {
  const raw = String(env.VIGILGRACE_SERVER_KEY_SEED || '').trim();
  if (!raw) return null;
  let bytes;
  if (/^[0-9a-fA-F]{64,}$/.test(raw) && raw.length % 2 === 0) {
    bytes = Buffer.from(raw, 'hex');
  } else {
    try {
      bytes = Buffer.from(raw, 'base64');
    } catch {
      return null;
    }
  }
  return bytes && bytes.length >= 32 ? bytes : null;
}

/** Expanded seeds: ML-KEM-768 needs 64 bytes (d||z), ML-DSA-65 needs 32. */
function deriveSeeds(root) {
  const expand = (label, length) => {
    const out = Buffer.alloc(0);
    let counter = 0;
    while (out.length < length) {
      counter += 1;
      out = Buffer.concat([out, createHash('sha256').update(root).update(`${label}:${counter}`).digest()]);
    }
    return new Uint8Array(out.subarray(0, length));
  };
  return {
    kem: expand('vigilgrace/server/kem', ml_kem768.lengths.seed),
    dsa: expand('vigilgrace/server/dsa', ml_dsa65.lengths.seed),
  };
}

function generateKeyMaterial(seeds) {
  const kem = ml_kem768.keygen(seeds?.kem ?? new Uint8Array(randomBytes(ml_kem768.lengths.seed)));
  const dsa = ml_dsa65.keygen(seeds?.dsa ?? new Uint8Array(randomBytes(ml_dsa65.lengths.seed)));
  return {
    kemPublicKeyB64: toBase64(kem.publicKey),
    kemSecretKeyB64: toBase64(kem.secretKey),
    sigPublicKeyB64: toBase64(dsa.publicKey),
    sigSecretKeyB64: toBase64(dsa.secretKey),
    algorithms: ALGORITHMS,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Load the server keypair, creating it on first use. When a seed is configured
 * the derived keys are authoritative (a stale file copy is replaced).
 */
export function loadOrCreateServerKeys(store, env = process.env) {
  const seed = seedFromEnv(env);
  const existing = store.data.serverKeys;

  if (seed) {
    const derived = generateKeyMaterial(deriveSeeds(seed));
    if (!existing || existing.kemPublicKeyB64 !== derived.kemPublicKeyB64) {
      store.data.serverKeys = { ...derived, source: 'seed' };
      store.save();
    }
    return store.data.serverKeys;
  }

  if (existing && existing.kemPublicKeyB64 && existing.kemSecretKeyB64 && existing.sigPublicKeyB64) {
    return existing;
  }
  const generated = generateKeyMaterial(null);
  store.data.serverKeys = { ...generated, source: 'generated' };
  store.save();
  return store.data.serverKeys;
}

/** The only shape an HTTP route may expose. Never includes secret halves. */
export function publicServerKeys(store, env = process.env) {
  const keys = loadOrCreateServerKeys(store, env);
  return {
    kemPublicKeyB64: keys.kemPublicKeyB64,
    sigPublicKeyB64: keys.sigPublicKeyB64,
    algorithms: { ...ALGORITHMS },
  };
}

/** Raw secret-half accessor for the envelope decryptor (never for responses). */
export function serverKemSecretKey(store, env = process.env) {
  const keys = loadOrCreateServerKeys(store, env);
  return new Uint8Array(Buffer.from(keys.kemSecretKeyB64, 'base64'));
}
