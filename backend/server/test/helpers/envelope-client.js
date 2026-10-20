/**
 * Test-only client sealer for the backend suite (node --test, plain JS).
 *
 * This is an INDEPENDENT implementation of the app's
 * src/core/crypto/envelope.ts — deliberately not imported, so the two must agree
 * on the wire format rather than sharing a bug. The app-side compatibility is
 * proven separately, over real HTTP, in tests/sos-alert-e2e.test.ts (which seals
 * with the real app code).
 *
 * Test key material only: nothing here touches a real identity or a real handset.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

const HKDF_INFO = new TextEncoder().encode('vigilgrace/sos/v1');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

export function seededRandom(seed = 42) {
  let state = seed >>> 0;
  return (len) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out[i] = (state >>> 24) & 0xff;
    }
    return out;
  };
}

export function newSigner(seed = 1) {
  return ml_dsa65.keygen(seededRandom(seed)(ml_dsa65.lengths.seed));
}

/** Client-side KEM keypair — used to seal to a key the server does NOT own. */
export function newKem(seed = 1) {
  return ml_kem768.keygen(seededRandom(seed)(ml_kem768.lengths.seed));
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sealEnvelope({ payload, serverKemPublicKey, signer, random = seededRandom(7) }) {
  const plaintext = new TextEncoder().encode(canonicalJson(payload));
  const msgRand = random(ml_kem768.lengths.msgRand);
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(serverKemPublicKey, msgRand);
  const key = hkdf(sha256, sharedSecret, sha256(serverKemPublicKey), HKDF_INFO, 32);
  const nonce = random(12);
  const aad = new TextEncoder().encode(`vigilgrace/sos/envelope/v1|${payload.alertId}`);
  const ciphertext = gcm(key, nonce, aad).encrypt(plaintext);

  const unsigned = {
    v: 1,
    alertId: payload.alertId,
    kem: 'ml-kem-768',
    sigAlg: 'ml-dsa-65',
    aead: 'aes-256-gcm',
    hashAlg: 'sha-256',
    kemCipherTextB64: b64(cipherText),
    nonceB64: b64(nonce),
    ctB64: b64(ciphertext),
    signerPubB64: b64(signer.publicKey),
    payloadHashB64: b64(sha256(plaintext)),
  };
  const signingInput = new TextEncoder().encode(
    [
      unsigned.v,
      unsigned.alertId,
      unsigned.kem,
      unsigned.sigAlg,
      unsigned.aead,
      unsigned.hashAlg,
      unsigned.kemCipherTextB64,
      unsigned.nonceB64,
      unsigned.ctB64,
      unsigned.signerPubB64,
      unsigned.payloadHashB64,
    ].join('|'),
  );
  return { ...unsigned, sigB64: b64(ml_dsa65.sign(signingInput, signer.secretKey)) };
}
