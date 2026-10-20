/**
 * SOS dispatch orchestration.
 *
 * 1. Acquire the fresst possible location (permission-aware, non-fatal).
 * 2. Build the alert payload (id, user, trigger, location, timestamp).
 * 3. Seal it: AES-256-GCM(payload) with an HKDF key derived from an ML-KEM-768
 *    encapsulation to the server's public key, then ML-DSA-65-sign the envelope.
 * 4. POST the envelope; the alertId is fixed for the whole run so retries are
 *    de-duplicated server-side.
 *
 * "Delivered" is NEVER assumed here — the backend returns per-contact delivery
 * results and the UI must reflect exactly those (including 'simulated' in mock
 * mode).
 */

import { fromBase64 } from '@/core/crypto/bytes';
import { sealAlertEnvelope, type SealedEnvelope } from '@/core/crypto/envelope';
import { buildEvidenceRecord, locationSnapshotEvidence } from '@/core/evidence/integrity';
import type { DispatchOutcome } from '@/core/sos/sos-machine';
import type {
  EmergencyAlertPayload,
  EvidenceMetadata,
  SosTriggerSource,
} from '@/core/types';
import { getApiBaseUrl } from './api';
import {
  ApiError,
  fetchServerCrypto,
  submitAlertEnvelope,
  type ServerCryptoInfo,
} from './backend';
import { cacheServerKeys, getCachedServerKeys, loadOrCreateIdentity } from './identity-keys';
import { getCurrentFix } from './location';
import { cryptoRandom, uuid } from './random';
import { loadSession } from './session';

const SERVER_KEYS_TTL_MS = 24 * 60 * 60 * 1000;

export function generateAlertId(): string {
  return uuid();
}

export async function resolveServerCrypto(force = false): Promise<ServerCryptoInfo> {
  const baseUrl = await getApiBaseUrl();
  if (!force) {
    // Only reuse keys that were fetched from the backend we are about to talk
    // to: envelopes sealed to another server's KEM key cannot be opened there.
    const cached = await getCachedServerKeys(baseUrl);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < SERVER_KEYS_TTL_MS) {
      return {
        kemPublicKeyB64: cached.kemPublicKeyB64,
        sigPublicKeyB64: cached.sigPublicKeyB64,
        algorithms: { kem: 'ml-kem-768', signature: 'ml-dsa-65', aead: 'aes-256-gcm', hash: 'sha-256' },
      };
    }
  }
  const info = await fetchServerCrypto();
  await cacheServerKeys(
    {
      kemPublicKeyB64: info.kemPublicKeyB64,
      sigPublicKeyB64: info.sigPublicKeyB64,
      fetchedAt: new Date().toISOString(),
    },
    baseUrl,
  );
  return info;
}

export interface DispatchSosOptions {
  alertId: string;
  source: SosTriggerSource;
  signals?: Record<string, number>;
  /** Evidence records to embed in the encrypted payload (metadata only). */
  evidence?: EvidenceMetadata[];
  message?: string;
}

export async function dispatchSos(options: DispatchSosOptions): Promise<DispatchOutcome> {
  const session = await loadSession();
  if (!session) {
    return { kind: 'rejected', error: 'Not signed in' };
  }

  try {
    const [identity, serverCrypto, location] = await Promise.all([
      loadOrCreateIdentity(),
      resolveServerCrypto(),
      // Ask for location permission here if it has never been granted: without
      // it the alert would carry no coordinates and the user would have no way
      // to fix that mid-emergency. Failure is non-fatal — the alert still sends.
      getCurrentFix({ requestPermission: true }),
    ]);

    const evidence: EvidenceMetadata[] = [...(options.evidence ?? [])];
    if (location) {
      evidence.push(
        locationSnapshotEvidence(location, uuid, new Date(location.timestamp).toISOString()),
      );
    }

    const payload: EmergencyAlertPayload = {
      alertId: options.alertId,
      userId: session.user.id,
      createdAt: new Date().toISOString(),
      trigger: options.source,
      location,
      message: options.message ?? 'SOS triggered — immediate assistance requested.',
      signals: options.signals,
      evidence: evidence.length > 0 ? evidence : undefined,
    };

    const envelope: SealedEnvelope = sealAlertEnvelope({
      payload,
      serverKemPublicKey: fromBase64(serverCrypto.kemPublicKeyB64),
      signer: identity.dsa,
      random: cryptoRandom,
    });

    const response = await submitAlertEnvelope(session.token, envelope);
    return { kind: 'accepted', report: response.report };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status >= 400 && err.status < 500) {
        return { kind: 'rejected', error: err.message };
      }
      return { kind: 'unavailable', error: err.message };
    }
    // fetch()/network failures
    return {
      kind: 'unavailable',
      error: (err as Error).message || 'Network unavailable',
    };
  }
}

export function audioContentTypeForUri(localUri: string): string {
  const ext = localUri.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (ext === '3gp') return 'audio/3gpp';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'caf') return 'audio/x-caf';
  if (ext === 'aac') return 'audio/aac';
  // RecordingPresets produce MPEG-4 containers on both iOS and Android.
  return 'audio/mp4';
}

/** Build evidence metadata for a consented audio clip from its raw bytes. */
export function audioEvidenceRecord(
  localUri: string,
  bytes: Uint8Array,
  sizeBytes = bytes.length,
): EvidenceMetadata {
  return buildEvidenceRecord({
    id: uuid(),
    kind: 'audio',
    createdAt: new Date().toISOString(),
    sha256: '',
    localUri,
    uploaded: false,
    // Describe the container the recorder actually produced instead of
    // hardcoding one extension's MIME type for every platform.
    contentType: audioContentTypeForUri(localUri),
    sizeBytes,
    contentForHash: bytes,
  });
}
