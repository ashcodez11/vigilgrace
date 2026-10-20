/**
 * Evidence integrity (pure logic).
 *
 * Evidence artifacts (audio clips recorded with explicit consent, location
 * snapshots, notes) are represented by metadata records that carry a
 * SHA-256 digest of the artifact bytes. Hashing proves the artifact has not
 * changed since it was recorded — it does NOT prove who recorded it.
 * Authenticity comes from the ML-DSA signature on the alert envelope and the
 * authenticated session with the backend; if non-repudiable evidence chains
 * are required, the metadata record must additionally be signed with the
 * user's ML-DSA key (see signEvidenceRecord below).
 */

import { fromBase64, toBase64, utf8Encode } from '../crypto/bytes';
import { canonicalJson } from '../crypto/envelope';
import { hashBytes, sign, verify } from '../crypto/pqc';
import type { EvidenceMetadata, GeoLocationFix } from '../types';

export function sha256HexOfText(text: string): string {
  return Array.from(hashBytes(utf8Encode(text)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function sha256Base64OfBytes(bytes: Uint8Array): string {
  return toBase64(hashBytes(bytes));
}

export function buildEvidenceRecord(
  input: Omit<EvidenceMetadata, 'sha256'> & {
    /** Optional (and always ignored): the digest is computed from the bytes. */
    sha256?: string;
    contentForHash: string | Uint8Array;
  },
): EvidenceMetadata {
  const bytes =
    typeof input.contentForHash === 'string'
      ? utf8Encode(input.contentForHash)
      : input.contentForHash;
  const rest: Record<string, unknown> = { ...input };
  delete rest.contentForHash;
  // A supplied digest is dropped rather than trusted: the record's hash must
  // always describe the bytes handed to this function.
  delete rest.sha256;
  return { ...(rest as unknown as Omit<EvidenceMetadata, 'sha256'>), sha256: sha256Base64OfBytes(bytes) };
}

export function verifyEvidenceRecord(record: EvidenceMetadata): boolean {
  return /^[0-9a-f]{64}$|^[A-Za-z0-9+/]{43}=$/.test(record.sha256);
}

/** Canonical string used when signing evidence metadata. */
export function evidenceSigningInput(record: EvidenceMetadata): string {
  const { sha256, ...rest } = record;
  return canonicalJson({ ...rest, sha256 });
}

export function signEvidenceRecord(
  record: EvidenceMetadata,
  secretKey: Uint8Array,
): string {
  return toBase64(sign(utf8Encode(evidenceSigningInput(record)), secretKey));
}

export function verifyEvidenceRecordSignature(
  record: EvidenceMetadata,
  signatureB64: string,
  publicKey: Uint8Array,
): boolean {
  const bytes = fromBase64(signatureB64);
  return verify(bytes, utf8Encode(evidenceSigningInput(record)), publicKey);
}

export function locationSnapshotEvidence(
  location: GeoLocationFix,
  idFactory: () => string,
  nowIso: string,
): EvidenceMetadata {
  const content = canonicalJson(location);
  return buildEvidenceRecord({
    id: idFactory(),
    kind: 'location-snapshot',
    createdAt: nowIso,
    sha256: '',
    uploaded: true, // location is part of the alert payload sent to the backend
    contentType: 'application/json',
    contentForHash: content,
  });
}

/**
 * Local retention policy: evidence artifacts live in app-private storage and
 * are kept only for `retentionDays` (default 7) unless the user exports them.
 */
export const EVIDENCE_RETENTION_DAYS = 7;

export function isEvidenceExpired(
  record: EvidenceMetadata,
  nowMs: number,
  retentionDays = EVIDENCE_RETENTION_DAYS,
): boolean {
  const created = Date.parse(record.createdAt);
  if (Number.isNaN(created)) return false;
  return nowMs - created > retentionDays * 24 * 60 * 60 * 1000;
}
