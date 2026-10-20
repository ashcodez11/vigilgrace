/**
 * Backend alert-slice regression tests (node --test, loopback only).
 *
 * What these pin: an alert is only recorded when it is signed by the key
 * registered for the account and its envelope actually opens; delivery is
 * reported honestly (simulated / provider-accepted / failed with a reason); the
 * same alertId is never delivered twice; history and evidence are owner-scoped;
 * and no secret key material ever leaves the server.
 *
 * No SMS is sent anywhere: the provider is the explicit dev mock
 * (VIGILGRACE_ALLOW_MOCK=1) or nothing at all.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';

import { buildApp } from '../src/app.js';
import { createStore } from '../src/util/store.js';
import { newKem, newSigner, sealEnvelope, seededRandom } from './helpers/envelope-client.js';

const PLACEHOLDER_PHONE = '+919000000000';
const MOCK_ENV = { VIGILGRACE_SMS_PROVIDER: 'mock', VIGILGRACE_ALLOW_MOCK: '1' };

const servers = [];

async function startServer(env = {}) {
  const store = createStore({ file: null });
  const app = buildApp({ store, env });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, store, env };
}

after(() => {
  for (const server of servers) server.close();
});

async function request(base, method, path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const post = (base, path, body, token) => request(base, 'POST', path, body, token);
const get = (base, path, token) => request(base, 'GET', path, undefined, token);

/** Register an account, publish a client identity keypair, return a handle. */
async function registerUser(base, seed = 1) {
  const email = `alerts-${Math.random().toString(36).slice(2)}@example.com`;
  const registered = await post(base, '/auth/register', {
    email,
    password: 'correct-horse-battery',
    name: 'Alert Owner',
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const token = registered.body.token;
  const signer = newSigner(seed);
  const kem = newKem(seed);
  const keys = await post(
    base,
    '/auth/keys',
    {
      mlKemPublicKeyB64: Buffer.from(kem.publicKey).toString('base64'),
      mlDsaPublicKeyB64: Buffer.from(signer.publicKey).toString('base64'),
    },
    token,
  );
  assert.equal(keys.status, 200);
  return { token, user: registered.body.user, signer };
}

/** Create and verify a contact through the mock-provider OTP flow. */
async function addVerifiedContact(base, token, phone = PLACEHOLDER_PHONE) {
  const created = await post(base, '/contacts', { name: 'Test contact', phone }, token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const sent = await post(base, `/contacts/${created.body.contact.id}/send-verify`, undefined, token);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const verified = await post(
    base,
    `/contacts/${created.body.contact.id}/verify`,
    { code: sent.body.devCode },
    token,
  );
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return verified.body.contact;
}

async function serverKemKey(base) {
  const response = await get(base, '/crypto/server-keys');
  assert.equal(response.status, 200);
  return Buffer.from(response.body.kemPublicKeyB64, 'base64');
}

function payloadFor(alertId, userId, extra = {}) {
  return {
    alertId,
    userId,
    createdAt: new Date().toISOString(),
    trigger: 'manual',
    location: null,
    message: 'SOS triggered — immediate assistance requested.',
    ...extra,
  };
}

describe('server post-quantum keys', () => {
  it('publishes only public halves and never logs secret material', async () => {
    const { base, store } = await startServer(MOCK_ENV);
    const response = await get(base, '/crypto/server-keys');

    assert.equal(response.status, 200);
    assert.equal(response.body.algorithms.kem, 'ml-kem-768');
    assert.equal(response.body.algorithms.signature, 'ml-dsa-65');
    assert.equal(typeof response.body.kemPublicKeyB64, 'string');
    assert.equal(JSON.stringify(response.body).includes('Secret'), false);
    assert.equal('kemSecretKeyB64' in response.body, false);
    // The server keeps its own secret half to be able to open envelopes.
    assert.ok(store.data.serverKeys.kemSecretKeyB64);
  });

  it('derives stable keys from VIGILGRACE_SERVER_KEY_SEED', async () => {
    const seed = 'a'.repeat(64);
    const one = await startServer({ ...MOCK_ENV, VIGILGRACE_SERVER_KEY_SEED: seed });
    const two = await startServer({ ...MOCK_ENV, VIGILGRACE_SERVER_KEY_SEED: seed });
    const a = await get(one.base, '/crypto/server-keys');
    const b = await get(two.base, '/crypto/server-keys');
    assert.equal(a.body.kemPublicKeyB64, b.body.kemPublicKeyB64);
    assert.equal(a.body.sigPublicKeyB64, b.body.sigPublicKeyB64);
  });
});

describe('accepting a sealed alert', () => {
  it('requires a session and a well-formed envelope', async () => {
    const { base } = await startServer(MOCK_ENV);
    const { token, user, signer } = await registerUser(base);

    assert.equal((await post(base, '/alerts', { envelope: {} })).status, 401);

    const malformed = await post(base, '/alerts', { envelope: { alertId: 'x' } }, token);
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.error, /Malformed alert envelope/);

    const missing = await post(base, '/alerts', {}, token);
    assert.equal(missing.status, 400);

    // A well-formed envelope that the server cannot open (sealed to someone
    // else's KEM key) is refused rather than stored.
    const otherKem = await startServer(MOCK_ENV);
    const foreignKem = await serverKemKey(otherKem.base);
    const envelope = sealEnvelope({
      payload: payloadFor('a_foreign', user.id),
      serverKemPublicKey: foreignKem,
      signer,
      random: seededRandom(4),
    });
    const refused = await post(base, '/alerts', { envelope }, token);
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(refused.body.error, /could not be opened/);
  });

  it('refuses an envelope signed with a key that is not registered', async () => {
    const { base, store } = await startServer(MOCK_ENV);
    const { token, user } = await registerUser(base);
    await addVerifiedContact(base, token);
    const kem = await serverKemKey(base);

    const envelope = sealEnvelope({
      payload: payloadFor('a_forged', user.id),
      serverKemPublicKey: kem,
      signer: newSigner(99),
      random: seededRandom(5),
    });
    const refused = await post(base, '/alerts', { envelope }, token);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /not registered for your account/);
    assert.equal(store.data.alerts.length, 0);
  });

  it('refuses a payload whose userId is not the caller', async () => {
    const { base } = await startServer(MOCK_ENV);
    const { token, signer } = await registerUser(base);
    await addVerifiedContact(base, token);
    const kem = await serverKemKey(base);

    const envelope = sealEnvelope({
      payload: payloadFor('a_someone_else', 'u_someone_else'),
      serverKemPublicKey: kem,
      signer,
      random: seededRandom(6),
    });
    const refused = await post(base, '/alerts', { envelope }, token);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /different account/);
  });

  it('refuses to invent delivery when no verified contact exists', async () => {
    const { base, store } = await startServer(MOCK_ENV);
    const { token, user, signer } = await registerUser(base);
    const kem = await serverKemKey(base);

    const envelope = sealEnvelope({
      payload: payloadFor('a_no_contacts', user.id),
      serverKemPublicKey: kem,
      signer,
      random: seededRandom(7),
    });
    const refused = await post(base, '/alerts', { envelope }, token);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /No verified emergency contacts/);
    // Nothing recorded, so a Retry after adding a contact still delivers.
    assert.equal(store.data.alerts.length, 0);
  });
});

describe('delivery reporting and history', () => {
  it('records the alert, reports simulated delivery and keeps the digest and envelope', async () => {
    const { base, store } = await startServer(MOCK_ENV);
    const { token, user, signer } = await registerUser(base, 2);
    const contact = await addVerifiedContact(base, token);
    const kem = await serverKemKey(base);

    const payload = payloadFor('a_ok', user.id, {
      location: { latitude: 12.9716, longitude: 77.5946, accuracyMeters: 8, altitudeMeters: 900, timestamp: Date.now() },
      evidence: [
        {
          id: 'ev_loc',
          kind: 'location-snapshot',
          createdAt: new Date().toISOString(),
          sha256: Buffer.alloc(32, 5).toString('base64'),
          uploaded: true,
          contentType: 'application/json',
          contentForHash: 'must not be stored',
        },
      ],
    });
    const envelope = sealEnvelope({ payload, serverKemPublicKey: kem, signer, random: seededRandom(8) });

    const accepted = await post(base, '/alerts', { envelope }, token);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.accepted, true);
    assert.equal(accepted.body.duplicate, false);
    assert.equal(accepted.body.report.status, 'delivered');
    assert.equal(accepted.body.report.deliveryMode, 'mock');
    assert.deepEqual(
      accepted.body.report.results.map((r) => [r.contactId, r.channel, r.state]),
      [[contact.id, 'sms', 'simulated']],
    );
    assert.match(accepted.body.report.results[0].detail, /no SMS/i);

    const stored = store.data.alerts[0];
    assert.equal(stored.id, 'a_ok');
    assert.equal(stored.payloadHashB64, envelope.payloadHashB64);
    assert.equal(stored.envelope.sigB64, envelope.sigB64, 'the signed envelope is kept for audit');
    assert.deepEqual(stored.location, { latitude: 12.9716, longitude: 77.5946 });
    // Evidence is metadata only; the raw content never reaches the store.
    assert.equal(stored.evidence.length, 1);
    assert.equal('contentForHash' in stored.evidence[0], false);

    const history = await get(base, '/alerts?limit=10', token);
    assert.equal(history.status, 200);
    assert.equal(history.body.alerts.length, 1);
    assert.equal(history.body.alerts[0].id, 'a_ok');
    assert.equal(history.body.alerts[0].payloadHashB64, envelope.payloadHashB64);
    assert.deepEqual(history.body.alerts[0].location, { latitude: 12.9716, longitude: 77.5946 });
    assert.equal(history.body.alerts[0].evidence.length, 1);

    const single = await get(base, '/alerts/a_ok', token);
    assert.equal(single.status, 200);
    assert.equal(single.body.report.alertId, 'a_ok');

    // A retry with the same alertId returns the stored verdict — no second send.
    const retry = await post(base, '/alerts', { envelope }, token);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    assert.deepEqual(retry.body.report, accepted.body.report);
    assert.equal(store.data.alerts.length, 1);
  });

  it('records the attempt but reports failure when no provider is configured', async () => {
    const { base, store, env } = await startServer({ ...MOCK_ENV });
    const { token, user, signer } = await registerUser(base, 3);
    await addVerifiedContact(base, token);
    const kem = await serverKemKey(base);

    // The operator removes the provider configuration (same live process).
    delete env.VIGILGRACE_SMS_PROVIDER;
    delete env.VIGILGRACE_ALLOW_MOCK;

    const envelope = sealEnvelope({
      payload: payloadFor('a_noprovider', user.id),
      serverKemPublicKey: kem,
      signer,
      random: seededRandom(10),
    });
    const accepted = await post(base, '/alerts', { envelope }, token);

    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.report.status, 'failed');
    assert.equal(accepted.body.report.deliveryMode, 'unknown');
    assert.deepEqual(
      accepted.body.report.results.map((r) => r.state),
      ['failed'],
    );
    assert.match(accepted.body.report.results[0].detail, /No SMS provider is configured/);
    assert.equal(store.data.alerts.length, 1, 'the emergency attempt is still recorded');
  });

  it('retries a recorded failed alert once the provider works, without re-messaging anyone reached', async () => {
    const { base, store, env } = await startServer(MOCK_ENV);
    const { token, user, signer } = await registerUser(base, 8);
    const contact = await addVerifiedContact(base, token);
    const kem = await serverKemKey(base);

    // The operator has no SMS provider configured when the emergency fires.
    delete env.VIGILGRACE_SMS_PROVIDER;
    delete env.VIGILGRACE_ALLOW_MOCK;

    const envelope = sealEnvelope({
      payload: payloadFor('a_retry', user.id),
      serverKemPublicKey: kem,
      signer,
      random: seededRandom(20),
    });
    const failed = await post(base, '/alerts', { envelope }, token);
    assert.equal(failed.status, 200, JSON.stringify(failed.body));
    assert.equal(failed.body.report.status, 'failed');
    assert.equal(failed.body.retried, undefined);

    // Provider fixed; the user taps "Retry (same alert ID)". That promise is
    // only honest if the recorded failure is re-attempted instead of replaying
    // the stored verdict forever.
    env.VIGILGRACE_SMS_PROVIDER = 'mock';
    env.VIGILGRACE_ALLOW_MOCK = '1';

    const retried = await post(base, '/alerts', { envelope }, token);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.duplicate, true);
    assert.equal(retried.body.retried, true);
    assert.equal(retried.body.report.status, 'delivered');
    assert.deepEqual(
      retried.body.report.results.map((r) => [r.contactId, r.state]),
      [[contact.id, 'simulated']],
    );
    assert.equal(store.data.alerts.length, 1, 'still one alert, not a second emergency');
    assert.equal(store.data.alerts[0].status, 'delivered');

    // Once delivered, the alert is immutable: another retry must not message
    // the same contact a second time.
    const again = await post(base, '/alerts', { envelope }, token);
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.retried, undefined);
    assert.equal(again.body.report.updatedAt, retried.body.report.updatedAt);
  });

  it('scopes history and single-alert reads to the owner', async () => {
    const { base } = await startServer(MOCK_ENV);
    const owner = await registerUser(base, 4);
    await addVerifiedContact(base, owner.token);
    const kem = await serverKemKey(base);
    const envelope = sealEnvelope({
      payload: payloadFor('a_owned', owner.user.id),
      serverKemPublicKey: kem,
      signer: owner.signer,
      random: seededRandom(11),
    });
    assert.equal((await post(base, '/alerts', { envelope }, owner.token)).status, 200);

    const stranger = await registerUser(base, 5);
    assert.deepEqual((await get(base, '/alerts', stranger.token)).body.alerts, []);
    assert.equal((await get(base, '/alerts/a_owned', stranger.token)).status, 404);
    assert.equal((await post(base, '/alerts/a_owned/evidence', { records: [] }, stranger.token)).status, 404);
  });
});

describe('evidence metadata attachment', () => {
  const record = {
    id: 'ev_audio_1',
    kind: 'audio',
    createdAt: new Date().toISOString(),
    sha256: Buffer.alloc(32, 7).toString('base64'),
    localUri: 'file:///app-private/evidence.m4a',
    uploaded: false,
    contentType: 'audio/m4a',
    sizeBytes: 2048,
  };

  async function alertFixture() {
    const { base, store } = await startServer(MOCK_ENV);
    const { token, user, signer } = await registerUser(base, 6);
    await addVerifiedContact(base, token);
    const kem = await serverKemKey(base);
    const envelope = sealEnvelope({
      payload: payloadFor('a_evidence', user.id),
      serverKemPublicKey: kem,
      signer,
      random: seededRandom(12),
    });
    assert.equal((await post(base, '/alerts', { envelope }, token)).status, 200);
    return { base, store, token };
  }

  it('accepts metadata, is idempotent by id and rejects raw content', async () => {
    const { base, store, token } = await alertFixture();

    const attached = await post(base, '/alerts/a_evidence/evidence', { records: [record] }, token);
    assert.equal(attached.status, 200, JSON.stringify(attached.body));
    assert.equal(attached.body.evidence.length, 1);
    assert.equal(attached.body.evidence[0].sha256, record.sha256);

    // Re-posting the same record id must not duplicate it.
    const again = await post(base, '/alerts/a_evidence/evidence', { records: [record] }, token);
    assert.equal(again.body.evidence.length, 1);

    const raw = await post(
      base,
      '/alerts/a_evidence/evidence',
      { records: [{ ...record, id: 'ev_raw', contentForHash: 'bytes-here' }] },
      token,
    );
    assert.equal(raw.status, 400);
    assert.match(raw.body.error, /metadata only/);

    const noDigest = await post(
      base,
      '/alerts/a_evidence/evidence',
      { records: [{ ...record, id: 'ev_bad', sha256: 'not-a-digest' }] },
      token,
    );
    assert.equal(noDigest.status, 400);

    const empty = await post(base, '/alerts/a_evidence/evidence', { records: [] }, token);
    assert.equal(empty.status, 400);

    assert.equal(store.data.alerts[0].evidence.length, 1);
  });

  it('never exposes uploaded audio bytes, only digests and local URIs', async () => {
    const { base, token } = await alertFixture();
    await post(base, '/alerts/a_evidence/evidence', { records: [record] }, token);

    const history = await get(base, '/alerts', token);
    const evidence = history.body.alerts[0].evidence[0];
    assert.equal(evidence.uploaded, false);
    assert.equal(evidence.localUri, 'file:///app-private/evidence.m4a');
    assert.equal(evidence.contentType, 'audio/m4a');
    assert.equal(JSON.stringify(history.body).includes('bytes'), false);
  });
});
