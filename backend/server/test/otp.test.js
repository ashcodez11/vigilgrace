/**
 * Backend OTP regression tests (node --test, no network beyond loopback).
 *
 * These pin the behaviour that failed for the owner: the flow must refuse with
 * an actionable reason when no SMS provider is configured, must never generate
 * or claim a code it cannot send, and must verify codes correctly when a
 * provider (here: an explicit mock mode or a loopback webhook) is available.
 *
 * The owner's test number is used only as data; no SMS leaves this machine.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';

import { buildApp } from '../src/app.js';
import { createStore } from '../src/util/store.js';

const TEST_PHONE_LOCAL = '9000000001';
const TEST_PHONE_E164 = '+919000000001';

const servers = [];

/** Start the real app on a loopback port with an in-memory store. */
async function startServer(env = {}, { clock } = {}) {
  const store = createStore({ file: null });
  const app = buildApp({
    store,
    env,
    ...(clock ? { now: () => clock.value } : {}),
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, store, server };
}

after(() => {
  for (const server of servers) server.close();
});

async function post(base, path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Register a user, create the owner's test contact, return handles. */
async function withContact(base, phone = TEST_PHONE_LOCAL) {
  const email = `owner-${Math.random().toString(36).slice(2)}@example.com`;
  const registered = await post(base, '/auth/register', {
    email,
    password: 'correct-horse-battery',
    name: 'Owner',
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const token = registered.body.token;

  const created = await post(base, '/contacts', { name: 'Test contact', phone }, token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { token, contact: created.body.contact };
}

describe('health and configuration reporting', () => {
  it('reports an unconfigured SMS provider honestly', async () => {
    const { base } = await startServer({});
    const body = await (await fetch(`${base}/health`)).json();
    assert.equal(body.ok, true);
    assert.equal(body.smsProvider, 'unknown');
  });

  it('reports mock only when explicitly allowed', async () => {
    const { base } = await startServer({ VIGILGRACE_SMS_PROVIDER: 'mock' });
    const mode = (await (await fetch(`${base}/health`)).json()).smsProvider;
    assert.equal(mode, 'unknown', 'mock must not activate without VIGILGRACE_ALLOW_MOCK=1');
  });
});

describe('failure reason: no provider configured', () => {
  it('refuses with 503, sends nothing and burns no cooldown', async () => {
    const { base, store } = await startServer({});
    const { token, contact } = await withContact(base);

    const result = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    assert.equal(result.status, 503);
    assert.equal(result.body.delivery, 'unknown');
    assert.match(result.body.error, /No SMS provider is configured/);
    assert.match(result.body.error, /VIGILGRACE_SMS_PROVIDER/);

    // No code was generated or stored, and the contact is untouched.
    assert.equal(store.data.verifications.length, 0);
    const stored = store.data.contacts.find((c) => c.id === contact.id);
    assert.equal(stored.verified, false);
    assert.equal(stored.verifyRequestedAt, undefined);

    // Verifying without a code says exactly that.
    const verify = await post(base, `/contacts/${contact.id}/verify`, { code: '123456' }, token);
    assert.equal(verify.status, 400);
    assert.match(verify.body.error, /No verification code was requested/);
  });
});

describe('mock delivery (explicit dev mode)', () => {
  it('accepts the request, returns the code for the dev UI, and verifies it', async () => {
    const { base, store } = await startServer({
      VIGILGRACE_SMS_PROVIDER: 'mock',
      VIGILGRACE_ALLOW_MOCK: '1',
    });
    const { token, contact } = await withContact(base);

    const sent = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.delivery, 'mock');
    assert.match(sent.body.devCode, /^\d{6}$/);

    // The stored record is a digest, never the code itself.
    const record = store.data.verifications[0];
    assert.notEqual(record.digest, sent.body.devCode);
    assert.equal(record.digest.length, 64);

    const verified = await post(
      base,
      `/contacts/${contact.id}/verify`,
      { code: sent.body.devCode },
      token,
    );
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.contact.verified, true);
    assert.equal(JSON.stringify(verified.body).includes(sent.body.devCode), false);

    // Single use: the same code cannot be replayed.
    const replay = await post(
      base,
      `/contacts/${contact.id}/verify`,
      { code: sent.body.devCode },
      token,
    );
    assert.equal(replay.status, 400);
  });

  it('rate-limits resends', async () => {
    const { base } = await startServer({
      VIGILGRACE_SMS_PROVIDER: 'mock',
      VIGILGRACE_ALLOW_MOCK: '1',
    });
    const { token, contact } = await withContact(base);
    assert.equal((await post(base, `/contacts/${contact.id}/send-verify`, undefined, token)).status, 200);
    const second = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    assert.equal(second.status, 429);
    assert.match(second.body.error, /too recently/i);
  });

  it('refuses a resend to an already-verified contact instead of spending another code', async () => {
    const { base } = await startServer({
      VIGILGRACE_SMS_PROVIDER: 'mock',
      VIGILGRACE_ALLOW_MOCK: '1',
    });
    const { token, contact } = await withContact(base);
    const sent = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    assert.equal(sent.status, 200);
    const verified = await post(
      base,
      `/contacts/${contact.id}/verify`,
      { code: sent.body.devCode },
      token,
    );
    assert.equal(verified.body.contact.verified, true);

    // Regression: this used to return 200 and dispatch another code, with no
    // cooldown, because the limiter died with the consumed record. A verified
    // contact has no business receiving more codes (the app only offers the
    // button for unverified contacts).
    const again = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.match(again.body.error, /already verified/i);
    assert.equal(again.body.delivery, undefined, 'no delivery verdict for a send that never happened');
    assert.equal(again.body.devCode, undefined);
  });

  it('keeps the resend cooldown after the code record is gone', async () => {
    // Regression: the cooldown was measured against the live code record. Once
    // that record was dropped (here: an expired code being presented), the
    // limiter reset and another code could be dispatched straight away.
    const clock = { value: 1_700_000_000_000 };
    const { base } = await startServer(
      {
        VIGILGRACE_SMS_PROVIDER: 'mock',
        VIGILGRACE_ALLOW_MOCK: '1',
        // Code lifetime shorter than the cooldown, so the record dies first.
        VIGILGRACE_VERIFY_TTL_SECONDS: '5',
        VIGILGRACE_VERIFY_COOLDOWN_SECONDS: '600',
      },
      { clock },
    );
    const { token, contact } = await withContact(base);
    const sent = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    assert.equal(sent.status, 200);

    clock.value += 10_000;
    const expired = await post(
      base,
      `/contacts/${contact.id}/verify`,
      { code: sent.body.devCode },
      token,
    );
    assert.equal(expired.status, 410, JSON.stringify(expired.body));

    const resend = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    assert.equal(resend.status, 429, 'the limiter must outlive the code record');
    assert.match(resend.body.error, /too recently/i);
  });

  it('expires codes and limits wrong attempts', async () => {
    const clock = { value: 1_700_000_000_000 };
    const { base } = await startServer(
      { VIGILGRACE_SMS_PROVIDER: 'mock', VIGILGRACE_ALLOW_MOCK: '1' },
      { clock },
    );
    const { token, contact } = await withContact(base);

    const sent1 = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    assert.equal(sent1.status, 200);

    // Wrong code: attempts are counted and reported.
    const wrong = await post(base, `/contacts/${contact.id}/verify`, { code: '000000' }, token);
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /Incorrect verification code/);

    // Expiry: move the clock past the TTL.
    clock.value += 601_000;
    const expired = await post(
      base,
      `/contacts/${contact.id}/verify`,
      { code: sent1.body.devCode },
      token,
    );
    assert.equal(expired.status, 410);
    assert.match(expired.body.error, /expired/i);
  });
});

describe('provider dispatch through a webhook', () => {
  it('sends the E.164 number (10-digit locals become +91) and reports acceptance only', async () => {
    const received = [];
    const webhook = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        received.push(JSON.parse(raw));
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise((resolve) => webhook.listen(0, '127.0.0.1', resolve));
    servers.push(webhook);
    const webhookUrl = `http://127.0.0.1:${webhook.address().port}/sms`;

    const { base } = await startServer({ VIGILGRACE_SMS_WEBHOOK_URL: webhookUrl });
    const { token, contact } = await withContact(base);
    const sent = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);

    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.delivery, 'webhook');
    assert.equal(sent.body.devCode, undefined, 'a real provider must never echo the code to the app');
    assert.equal(received.length, 1);
    assert.equal(received[0].to, TEST_PHONE_E164);
    assert.match(received[0].code, /^\d{6}$/);
    assert.equal(received[0].contactId, contact.id);
  });

  it('never leaves a live code behind when the provider rejects the message', async () => {
    const webhook = createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('provider exploded');
    });
    await new Promise((resolve) => webhook.listen(0, '127.0.0.1', resolve));
    servers.push(webhook);

    const { base, store } = await startServer({
      VIGILGRACE_SMS_WEBHOOK_URL: `http://127.0.0.1:${webhook.address().port}/sms`,
    });
    const { token, contact } = await withContact(base);
    const sent = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);

    assert.equal(sent.status, 502);
    assert.match(sent.body.error, /webhook rejected/i);
    assert.equal(store.data.verifications.length, 0, 'no code may survive a failed dispatch');
  });
});

describe('contact ownership, validation and re-verification', () => {
  it('scopes contacts to their owner', async () => {
    const { base } = await startServer({});
    const owner = await withContact(base);

    const other = await post(base, '/auth/register', {
      email: `other-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'correct-horse-battery',
      name: 'Someone else',
    });
    const otherToken = other.body.token;

    const list = await (await fetch(`${base}/contacts`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    })).json();
    assert.deepEqual(list.contacts, []);

    const attempt = await post(base, `/contacts/${owner.contact.id}/send-verify`, undefined, otherToken);
    assert.equal(attempt.status, 404);
  });

  it('validates phone numbers the same way the app does', async () => {
    const { base } = await startServer({});
    const registered = await post(base, '/auth/register', {
      email: `v-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'correct-horse-battery',
      name: 'Owner',
    });
    const token = registered.body.token;

    const bad = await post(base, '/contacts', { name: 'Bad phone', phone: 'abc' }, token);
    assert.equal(bad.status, 400);

    const short = await post(base, '/contacts', { name: 'Short', phone: '123456789' }, token);
    assert.equal(short.status, 400);
    assert.match(short.body.error, /international/i);

    const ok = await post(base, '/contacts', { name: 'Local ten', phone: '90000-00001' }, token);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.contact.phone, '9000000001');
  });

  it('requires re-verification after the number changes', async () => {
    const { base } = await startServer({
      VIGILGRACE_SMS_PROVIDER: 'mock',
      VIGILGRACE_ALLOW_MOCK: '1',
    });
    const { token, contact } = await withContact(base);
    const sent = await post(base, `/contacts/${contact.id}/send-verify`, undefined, token);
    await post(base, `/contacts/${contact.id}/verify`, { code: sent.body.devCode }, token);

    const patched = await fetch(`${base}/contacts/${contact.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone: '+919000000002' }),
    });
    const body = await patched.json();
    assert.equal(patched.status, 200);
    assert.equal(body.contact.verified, false, 'a new number must never inherit verification');
    assert.equal(body.contact.verifyRequestedAt, undefined);
  });
});

describe('auth hygiene', () => {
  it('never returns password material and rejects bad credentials uniformly', async () => {
    const { base } = await startServer({});
    const email = `login-${Math.random().toString(36).slice(2)}@example.com`;
    const registered = await post(base, '/auth/register', {
      email,
      password: 'correct-horse-battery',
      name: 'Owner',
    });
    assert.equal(JSON.stringify(registered.body).includes('passwordHash'), false);
    assert.equal(JSON.stringify(registered.body).includes('correct-horse-battery'), false);

    const wrongPassword = await post(base, '/auth/login', { email, password: 'nope-nope-nope' });
    const unknownUser = await post(base, '/auth/login', {
      email: 'ghost@example.com',
      password: 'nope-nope-nope',
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.equal(wrongPassword.body.error, unknownUser.body.error, 'no account enumeration');
  });

  it('requires a session on every contact endpoint', async () => {
    const { base } = await startServer({});
    assert.equal((await post(base, '/contacts', { name: 'X', phone: '9000000002' })).status, 401);
  });
});
