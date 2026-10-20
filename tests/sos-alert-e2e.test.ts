/**
 * End-to-end SOS delivery test.
 *
 * This drives the app's REAL code — the real HTTP client, the real envelope
 * sealing, the real `dispatchSos` service — against a REAL backend process
 * started with `node backend/server/src/index.js` on loopback, with its own
 * data file in the OS temp directory. Nothing is stubbed except the three
 * platform modules that cannot load under Node (react-native Platform,
 * expo-constants, expo-secure-store) plus expo-crypto (CSPRNG) and
 * expo-location (deliberately broken here — see the deliberate-failure case).
 *
 * Why this exists: the SOS workflow above the state machine was untested, and
 * the backend had no alert endpoints at all, so an SOS could never be
 * delivered. These cases pin the contract that makes delivery possible:
 * server keys → sealed envelope → verified/decrypted alert → per-contact
 * delivery results the app can report honestly.
 *
 * No real message is sent: the mock provider is explicit
 * (VIGILGRACE_SMS_PROVIDER=mock + VIGILGRACE_ALLOW_MOCK=1) and the contact
 * number below is a placeholder, not a real handset.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const secureStore = new Map<string, string>();

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { apiBaseUrl: '' } } } }));
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(randomBytes(length)),
  randomUUID: () => randomUUID(),
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secureStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secureStore.delete(key);
  },
}));
// Location is broken on purpose in this suite: an unavailable location module
// must not stop the alert (that is one of the defects pinned below).
vi.mock('expo-location', () => ({
  getForegroundPermissionsAsync: async () => {
    throw new Error('location module unavailable');
  },
  requestForegroundPermissionsAsync: async () => {
    throw new Error('location module unavailable');
  },
  getCurrentPositionAsync: async () => {
    throw new Error('location module unavailable');
  },
  getLastKnownPositionAsync: async () => null,
  Accuracy: { High: 6 },
}));

import Constants from 'expo-constants';
import { sealAlertEnvelope, type SealedEnvelope } from '@/core/crypto/envelope';
import { fromBase64, toBase64 } from '@/core/crypto/bytes';
import { generateKemKeyPair, generateSignatureKeyPair } from '@/core/crypto/pqc';
import { buildEvidenceRecord } from '@/core/evidence/integrity';
import type { EmergencyAlertPayload, SosTriggerSource } from '@/core/types';
import {
  ApiError,
  attachEvidence,
  createContact,
  fetchServerCrypto,
  listAlerts,
  registerUser,
  requestContactVerification,
  submitAlertEnvelope,
  uploadPublicKeys,
  verifyContact,
} from '@/services/backend';
import { loadOrCreateIdentity } from '@/services/identity-keys';
import { saveSession } from '@/services/session';
import { dispatchSos, generateAlertId } from '@/services/sos-service';

/** Deterministic-enough RNG for sealing in tests (never used for real alerts). */
function seededRandom(seed: number) {
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

const REPO_ROOT = path.resolve(__dirname, '..');
const PLACEHOLDER_PHONE = '+919000000000';
const PASSWORD = 'correct-horse-battery-staple';

interface Backend {
  base: string;
  stop: () => void;
  log: () => string;
}

const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function startBackend(env: Record<string, string>, dataFile?: string): Promise<Backend> {
  const port = await freePort();
  const dataDir = dataFile ? path.dirname(dataFile) : mkdtempSync(path.join(tmpdir(), 'vigilgrace-e2e-'));
  const child = spawn(process.execPath, ['backend/server/src/index.js'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      VIGILGRACE_HOST: '127.0.0.1',
      VIGILGRACE_DATA_FILE: dataFile ?? path.join(dataDir, 'db.json'),
      // Secrets are irrelevant here: the data dir is a throwaway temp folder.
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);

  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited with ${child.exitCode}:\n${output}`);
    }
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`backend did not become ready:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    base,
    stop: () => {
      child.kill('SIGKILL');
    },
    log: () => output,
  };
}

function setBase(url: string) {
  (Constants.expoConfig!.extra as Record<string, string>).apiBaseUrl = url;
}

/** Register an account with a real app-identity keypair published to the server. */
async function registerWithKeys(base: string) {
  setBase(base);
  const registered = await registerUser(
    `e2e.${Date.now()}.${Math.random().toString(36).slice(2)}@example.test`,
    PASSWORD,
    'E2E Owner',
  );
  const identity = await loadOrCreateIdentity();
  await uploadPublicKeys(registered.token, {
    mlKemPublicKeyB64: identity.kemPublicKeyB64,
    mlDsaPublicKeyB64: identity.dsaPublicKeyB64,
  });
  await saveSession(registered.token, registered.user);
  return { ...registered, identity };
}

async function seal(
  alertId: string,
  userId: string,
  signer: ReturnType<typeof generateSignatureKeyPair>,
  options: { source?: SosTriggerSource; kemPublicKeyB64?: string } = {},
): Promise<SealedEnvelope> {
  const kemPublicKeyB64 = options.kemPublicKeyB64 ?? (await fetchServerCrypto()).kemPublicKeyB64;
  const payload: EmergencyAlertPayload = {
    alertId,
    userId,
    createdAt: new Date().toISOString(),
    trigger: options.source ?? 'manual',
    location: null,
    message: 'SOS triggered — immediate assistance requested.',
    signals: { attempt: 1 },
  };
  return sealAlertEnvelope({
    payload,
    serverKemPublicKey: fromBase64(kemPublicKeyB64),
    signer,
    random: seededRandom(7),
  });
}

async function capture<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (err: unknown) => err,
  );
}

describe('SOS delivery end to end (app ⇄ real backend over HTTP)', () => {
  let backend: Backend;

  beforeAll(async () => {
    backend = await startBackend({
      VIGILGRACE_SMS_PROVIDER: 'mock',
      VIGILGRACE_ALLOW_MOCK: '1',
    });
  }, 40_000);

  afterAll(() => {
    backend?.stop();
    for (const child of children) child.kill('SIGKILL');
  });

  it('publishes only public server keys', async () => {
    setBase(backend.base);
    const response = await fetch(`${backend.base}/crypto/server-keys`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.kemPublicKeyB64).toBe('string');
    expect(typeof body.sigPublicKeyB64).toBe('string');
    expect(body.algorithms).toMatchObject({ kem: 'ml-kem-768', signature: 'ml-dsa-65' });
    // The secret halves must never appear in a response or a log.
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
    expect(backend.log()).not.toMatch(/secret/i);
  });

  it('requires a session', async () => {
    setBase(backend.base);
    const failure = await capture(
      submitAlertEnvelope('not-a-token', await seal(generateAlertId(), 'u_x', generateSignatureKeyPair(seededRandom(1)))),
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
  });

  it('dispatches a sealed alert to a verified contact and records the digest', async () => {
    const { token, user } = await registerWithKeys(backend.base);

    // Verified contact through the real OTP flow (mock provider: nothing is sent).
    const { contact } = await createContact(token, { name: 'E2E contact', phone: PLACEHOLDER_PHONE });
    const sent = await requestContactVerification(token, contact.id);
    expect(sent.delivery).toBe('mock');
    expect(sent.devCode).toMatch(/^\d{6}$/);
    await verifyContact(token, contact.id, sent.devCode!);

    const alertId = generateAlertId();
    const outcome = await dispatchSos({ alertId, source: 'manual', signals: { attempt: 1 } });

    expect(outcome.kind).toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    // Delivery is reported as simulated, never as a real send.
    expect(outcome.report.deliveryMode).toBe('mock');
    expect(outcome.report.status).toBe('delivered');
    expect(outcome.report.results).toHaveLength(1);
    expect(outcome.report.results[0]).toMatchObject({
      channel: 'sms',
      state: 'simulated',
    });
    expect(outcome.report.results[0]!.detail).toMatch(/no SMS/i);

    // The alert — and the payload digest the app can verify later — is recorded.
    const { alerts } = await listAlerts(token);
    expect(alerts.map((a) => a.id)).toContain(alertId);
    const stored = alerts.find((a) => a.id === alertId)!;
    expect(stored.payloadHashB64).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(stored.trigger).toBe('manual');
    expect(stored.deliveryMode).toBe('mock');
    expect(user.id).toBeTruthy();
  }, 60_000);

  it('still delivers when location is unavailable', async () => {
    // expo-location is mocked to throw in this suite: a broken/unavailable
    // location module must never stop the alert. Coordinates are simply absent.
    const { token } = await registerWithKeys(backend.base);
    const { contact } = await createContact(token, { name: 'No-GPS contact', phone: PLACEHOLDER_PHONE });
    const sent = await requestContactVerification(token, contact.id);
    await verifyContact(token, contact.id, sent.devCode!);

    const outcome = await dispatchSos({ alertId: generateAlertId(), source: 'shake' });
    expect(outcome.kind).toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    expect(outcome.report.results[0]!.state).toBe('simulated');

    const { alerts } = await listAlerts(token);
    expect(alerts[0]!.location).toBeNull();
  }, 60_000);

  it('is idempotent: the same alertId is not delivered twice', async () => {
    const { token, user, identity } = await registerWithKeys(backend.base);
    const { contact } = await createContact(token, { name: 'Dedupe contact', phone: PLACEHOLDER_PHONE });
    const sent = await requestContactVerification(token, contact.id);
    await verifyContact(token, contact.id, sent.devCode!);

    const alertId = generateAlertId();
    const envelope = await seal(alertId, user.id, identity.dsa);
    const first = await submitAlertEnvelope(token, envelope);
    const second = await submitAlertEnvelope(token, envelope);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.report.results).toHaveLength(first.report.results.length);
  }, 60_000);

  it('refuses an envelope signed by a key that is not registered for the account', async () => {
    const { token, user } = await registerWithKeys(backend.base);
    const { contact } = await createContact(token, { name: 'Forgery contact', phone: PLACEHOLDER_PHONE });
    const sent = await requestContactVerification(token, contact.id);
    await verifyContact(token, contact.id, sent.devCode!);

    const forged = await seal(generateAlertId(), user.id, generateSignatureKeyPair(seededRandom(42)));
    const failure = await capture(submitAlertEnvelope(token, forged));

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect((failure as Error).message).toMatch(/not registered for your account/i);

    // Nothing was delivered and no alert was recorded, so a retry is meaningful.
    const { alerts } = await listAlerts(token);
    expect(alerts).toHaveLength(0);
  }, 60_000);

  it('refuses a tampered envelope and an unopenable one, storing neither', async () => {
    const { token, user, identity } = await registerWithKeys(backend.base);
    const { contact } = await createContact(token, { name: 'Tamper contact', phone: PLACEHOLDER_PHONE });
    const sent = await requestContactVerification(token, contact.id);
    await verifyContact(token, contact.id, sent.devCode!);

    // Tampering with the ciphertext invalidates the signature that covers it,
    // so the alert is refused before any decryption is attempted.
    const envelope = await seal(generateAlertId(), user.id, identity.dsa);
    const ciphertext = fromBase64(envelope.ctB64);
    ciphertext[0] ^= 0xff;
    const tampered = { ...envelope, ctB64: toBase64(ciphertext) };
    const tamperedFailure = await capture(submitAlertEnvelope(token, tampered));
    expect(tamperedFailure).toBeInstanceOf(ApiError);
    expect((tamperedFailure as ApiError).status).toBe(400);
    expect((tamperedFailure as Error).message).toMatch(/signature is not valid/i);

    // Correctly signed, but sealed to a KEM key the server does not own: the
    // signature passes and decryption fails.
    const foreignKem = generateKemKeyPair(seededRandom(21));
    const unopenable = await seal(generateAlertId(), user.id, identity.dsa, {
      kemPublicKeyB64: toBase64(foreignKem.publicKey),
    });
    const unopenableFailure = await capture(submitAlertEnvelope(token, unopenable));
    expect(unopenableFailure).toBeInstanceOf(ApiError);
    expect((unopenableFailure as ApiError).status).toBe(400);
    expect((unopenableFailure as Error).message).toMatch(/could not be opened/i);

    const { alerts } = await listAlerts(token);
    expect(alerts).toHaveLength(0);
  }, 60_000);

  it('refuses to invent delivery when no verified contact exists', async () => {
    const { token, user, identity } = await registerWithKeys(backend.base);
    const alertId = generateAlertId();
    const envelope = await seal(alertId, user.id, identity.dsa);

    const failure = await capture(submitAlertEnvelope(token, envelope));
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(409);
    expect((failure as Error).message).toMatch(/No verified emergency contacts/i);

    // Nothing is recorded, so the same alertId can still be delivered after the
    // user adds a contact and taps Retry.
    const { alerts } = await listAlerts(token);
    expect(alerts).toHaveLength(0);
  }, 60_000);

  it('records the attempt and reports a real failure when the provider is not configured', async () => {
    // A verified contact is required to reach the dispatch path, so set the
    // account up on a mock-provider backend, then restart the SAME data file
    // without any provider — the operator's mistake this test pins.
    const dataFile = path.join(mkdtempSync(path.join(tmpdir(), 'vigilgrace-heal-')), 'db.json');
    const withMock = await startBackend(
      { VIGILGRACE_SMS_PROVIDER: 'mock', VIGILGRACE_ALLOW_MOCK: '1' },
      dataFile,
    );
    try {
      setBase(withMock.base);
      const { token, user } = await registerWithKeys(withMock.base);
      const { contact } = await createContact(token, { name: 'Verified contact', phone: PLACEHOLDER_PHONE });
      const sent = await requestContactVerification(token, contact.id);
      await verifyContact(token, contact.id, sent.devCode!);
      withMock.stop();

      const withoutProvider = await startBackend({}, dataFile);
      try {
        // A different port = a different backend URL. The client must fetch that
        // server's keys instead of reusing the ones cached for the previous URL,
        // otherwise every envelope is sealed to the wrong KEM key and refused.
        setBase(withoutProvider.base);
        const outcome = await dispatchSos({ alertId: generateAlertId(), source: 'manual' });

        if (outcome.kind !== 'accepted') {
          throw new Error(`unexpected dispatch outcome: ${JSON.stringify(outcome)}`);
        }
        expect(outcome.kind).toBe('accepted');
        // The attempt is recorded, but it is reported as a failure with the
        // actionable reason — never as delivered.
        expect(outcome.report.status).toBe('failed');
        expect(outcome.report.deliveryMode).toBe('unknown');
        expect(outcome.report.results[0]!.state).toBe('failed');
        expect(outcome.report.results[0]!.detail).toMatch(/No SMS provider is configured/i);

        const { alerts } = await listAlerts(token);
        expect(alerts).toHaveLength(1);
        expect(alerts[0]!.status).toBe('failed');
        expect(user.id).toBeTruthy();
      } finally {
        withoutProvider.stop();
      }
    } finally {
      withMock.stop();
    }
  }, 60_000);

  it('accepts evidence METADATA only and rejects raw content', async () => {
    const { token, user, identity } = await registerWithKeys(backend.base);
    const { contact } = await createContact(token, { name: 'Evidence contact', phone: PLACEHOLDER_PHONE });
    const sent = await requestContactVerification(token, contact.id);
    await verifyContact(token, contact.id, sent.devCode!);

    const alertId = generateAlertId();
    const envelope = await seal(alertId, user.id, identity.dsa);
    await submitAlertEnvelope(token, envelope);

    const record = buildEvidenceRecord({
      id: 'ev_1',
      kind: 'audio',
      createdAt: new Date().toISOString(),
      localUri: 'file:///app-private/evidence.m4a',
      uploaded: false,
      contentType: 'audio/m4a',
      contentForHash: new Uint8Array([1, 2, 3, 4]),
    });
    // The digest always describes the bytes handed in, never a caller's value.
    expect(record.sha256).toMatch(/^[A-Za-z0-9+/]{43}=$/);

    const attached = await attachEvidence(token, alertId, [record]);
    expect(attached.ok).toBe(true);
    expect(attached.evidence).toHaveLength(1);

    const { alerts } = await listAlerts(token);
    expect(alerts.find((a) => a.id === alertId)!.evidence).toHaveLength(1);

    // Raw audio bytes are not evidence metadata and must be refused.
    const rawFailure = await capture(
      attachEvidence(token, alertId, [
        { ...record, id: 'ev_raw', contentForHash: 'not allowed' } as never,
      ]),
    );
    expect(rawFailure).toBeInstanceOf(ApiError);
    expect((rawFailure as ApiError).status).toBe(400);
    expect((rawFailure as Error).message).toMatch(/metadata only/i);
  }, 60_000);

  it('scopes alert history to its owner', async () => {
    const owner = await registerWithKeys(backend.base);
    const { contact } = await createContact(owner.token, { name: 'Owner contact', phone: PLACEHOLDER_PHONE });
    const sent = await requestContactVerification(owner.token, contact.id);
    await verifyContact(owner.token, contact.id, sent.devCode!);

    const alertId = generateAlertId();
    const envelope = await seal(alertId, owner.user.id, owner.identity.dsa);
    await submitAlertEnvelope(owner.token, envelope);

    const other = await registerWithKeys(backend.base);
    const { alerts } = await listAlerts(other.token);
    expect(alerts).toHaveLength(0);

    const failure = await capture(attachEvidence(other.token, alertId, []));
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
  }, 60_000);
});
