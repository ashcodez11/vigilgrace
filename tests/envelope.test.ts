import { describe, expect, it } from 'vitest';

import { toBase64, fromBase64, utf8Encode, utf8Decode } from '@/core/crypto/bytes';
import {
  EnvelopeError,
  canonicalJson,
  kemPublicKeyFromSecretKey,
  openAlertEnvelope,
  sealAlertEnvelope,
  verifyEnvelopeSignature,
} from '@/core/crypto/envelope';
import {
  deriveAeadKey,
  generateKemKeyPair,
  generateSignatureKeyPair,
  hashBytes,
} from '@/core/crypto/pqc';
import type { EmergencyAlertPayload } from '@/core/types';

/** Deterministic RNG for reproducible tests. */
function seededRandom(seed = 42) {
  let state = seed >>> 0;
  return (len: number) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out[i] = (state >>> 24) & 0xff;
    }
    return out;
  };
}

const payload: EmergencyAlertPayload = {
  alertId: '0d2f1a60-0000-4000-8000-000000000001',
  userId: 'user-1',
  createdAt: '2026-10-13T12:00:00.000Z',
  trigger: 'manual',
  location: {
    latitude: 12.9716,
    longitude: 77.5946,
    accuracyMeters: 8,
    altitudeMeters: 900,
    timestamp: 1760350000000,
  },
  message: 'SOS: I need help',
  signals: { shake: 0.9 },
};

describe('canonicalJson', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: { z: 1, y: [3, 2] } })).toBe(canonicalJson({ a: { y: [3, 2], z: 1 } }));
  });
});

describe('sealed alert envelope (app ↔ backend)', () => {
  const random = seededRandom();
  const serverKem = generateKemKeyPair(random);
  const clientSigner = generateSignatureKeyPair(random);

  it('round-trips: seal with client, open with server KEM secret key', () => {
    const env = sealAlertEnvelope({
      payload,
      serverKemPublicKey: serverKem.publicKey,
      signer: clientSigner,
      random,
    });
    expect(env.kem).toBe('ml-kem-768');
    expect(env.aead).toBe('aes-256-gcm');
    expect(env.sigAlg).toBe('ml-dsa-65');
    expect(verifyEnvelopeSignature(env)).toBe(true);

    const opened = openAlertEnvelope(env, serverKem.secretKey);
    expect(opened.payload).toEqual(payload);
    expect(opened.payloadJson.length).toBeGreaterThan(0);
  });

  it('recovers the same public key from the KEM secret key', () => {
    expect(kemPublicKeyFromSecretKey(serverKem.secretKey)).toEqual(serverKem.publicKey);
  });

  it('verifies payload hash detects tampering of the ciphertext', () => {
    const env = sealAlertEnvelope({
      payload,
      serverKemPublicKey: serverKem.publicKey,
      signer: clientSigner,
      random,
    });
    const ct = fromBase64(env.ctB64);
    ct[0] ^= 0xff;
    const tampered = { ...env, ctB64: toBase64(ct) };
    expect(() => openAlertEnvelope(tampered, serverKem.secretKey)).toThrow(EnvelopeError);
    try {
      openAlertEnvelope(tampered, serverKem.secretKey);
    } catch (err) {
      expect((err as EnvelopeError).code).toBe('decrypt-failure');
    }
  });

  it('rejects a signature made by a different key', () => {
    const env = sealAlertEnvelope({
      payload,
      serverKemPublicKey: serverKem.publicKey,
      signer: clientSigner,
      random,
    });
    const attacker = generateSignatureKeyPair(seededRandom(7));
    const forged = { ...env, signerPubB64: toBase64(attacker.publicKey) };
    expect(verifyEnvelopeSignature(forged)).toBe(false);
    // ...and the original still verifies against the real key
    expect(verifyEnvelopeSignature(env)).toBe(true);
  });

  it('cannot be opened by a different server KEM key', () => {
    const env = sealAlertEnvelope({
      payload,
      serverKemPublicKey: serverKem.publicKey,
      signer: clientSigner,
      random,
    });
    const otherServer = generateKemKeyPair(seededRandom(99));
    expect(() => openAlertEnvelope(env, otherServer.secretKey)).toThrow(EnvelopeError);
  });

  it('derives the AEAD key with HKDF-SHA-256 bound to the KEM public key', () => {
    const a = generateKemKeyPair(seededRandom(11));
    const keyA = deriveAeadKey(hashBytes(new Uint8Array([1, 2, 3])), hashBytes(a.publicKey));
    expect(keyA.length).toBe(32);
  });
});

describe('base64 / utf8 helpers', () => {
  it('round-trips binary data', () => {
    const bytes = new Uint8Array(1024).map((_, i) => i % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
  it('round-trips text', () => {
    expect(utf8Decode(utf8Encode('SOS आपातकाल 🚨'))).toBe('SOS आपातकाल 🚨');
  });
});
