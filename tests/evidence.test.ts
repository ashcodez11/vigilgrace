import { describe, expect, it } from 'vitest';

import { generateSignatureKeyPair, hashBytes, hashHex } from '@/core/crypto/pqc';
import {
  buildEvidenceRecord,
  evidenceSigningInput,
  isEvidenceExpired,
  sha256Base64OfBytes,
  signEvidenceRecord,
  verifyEvidenceRecord,
  verifyEvidenceRecordSignature,
} from '@/core/evidence/integrity';
import { utf8Encode } from '@/core/crypto/bytes';

describe('evidence integrity', () => {
  const random = (len: number) => new Uint8Array(len).fill(3);
  const keys = generateSignatureKeyPair(random);

  it('builds a record with a sha256 digest of the artifact content', () => {
    const record = buildEvidenceRecord({
      id: 'ev1',
      kind: 'audio',
      createdAt: '2026-10-13T10:00:00.000Z',
      sha256: '',
      uploaded: false,
      contentType: 'audio/mp4',
      contentForHash: 'pretend audio bytes',
    });
    expect(record.sha256).toBe(sha256Base64OfBytes(utf8Encode('pretend audio bytes')));
    expect(verifyEvidenceRecord(record)).toBe(true);
  });

  it('digest changes when the artifact changes (tamper evident)', () => {
    const a = buildEvidenceRecord({
      id: 'ev1',
      kind: 'audio',
      createdAt: '2026-10-13T10:00:00.000Z',
      sha256: '',
      uploaded: false,
      contentForHash: 'artifact-v1',
    });
    const b = buildEvidenceRecord({
      id: 'ev1',
      kind: 'audio',
      createdAt: '2026-10-13T10:00:00.000Z',
      sha256: '',
      uploaded: false,
      contentForHash: 'artifact-v2',
    });
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('ML-DSA signature binds the metadata record and detects tampering', () => {
    const record = buildEvidenceRecord({
      id: 'ev2',
      kind: 'location-snapshot',
      createdAt: '2026-10-13T10:00:00.000Z',
      sha256: '',
      uploaded: true,
      contentForHash: '{"latitude":1}',
    });
    const signatureB64 = signEvidenceRecord(record, keys.secretKey);
    expect(verifyEvidenceRecordSignature(record, signatureB64, keys.publicKey)).toBe(true);

    const tampered = { ...record, createdAt: '2026-10-14T10:00:00.000Z' };
    expect(verifyEvidenceRecordSignature(tampered, signatureB64, keys.publicKey)).toBe(false);
    expect(evidenceSigningInput(tampered)).not.toBe(evidenceSigningInput(record));
  });

  it('applies the retention window', () => {
    const record = buildEvidenceRecord({
      id: 'ev3',
      kind: 'note',
      createdAt: '2026-10-01T00:00:00.000Z',
      sha256: '',
      uploaded: false,
      contentForHash: 'x',
    });
    const eightDaysLater = Date.parse('2026-10-09T00:00:00.000Z');
    expect(isEvidenceExpired(record, eightDaysLater)).toBe(true);
    expect(isEvidenceExpired(record, Date.parse('2026-10-02T00:00:00.000Z'))).toBe(false);
  });

  it('sha256 hash helper is stable', () => {
    expect(hashHex(utf8Encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashBytes(utf8Encode('abc')).length).toBe(32);
  });
});
