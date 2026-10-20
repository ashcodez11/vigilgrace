/**
 * Regression tests for the emergency-contact verification (OTP) request path.
 *
 * What was wrong: every failure looked the same to the user, and some of those
 * messages were untrue. An unreachable backend was reported as a server
 * configuration problem (and vice versa), and the screen entered "enter the
 * code" state even when the server had refused to send anything — so the user
 * waited for a code that had never been generated.
 *
 * These tests pin two things: the *reason* the user is shown, and the invariant
 * that the UI only asks for a code when the backend reports a provider actually
 * accepted one.
 *
 * Nothing leaves the machine: `fetch` is stubbed here and no provider is
 * contacted. The code value used below is a fabricated stub response, not a
 * real verification code, and no secret is read or written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The HTTP client is platform-aware and imports Expo/React Native modules that
// cannot load under Node. Only those three seams are replaced; everything under
// test — the store, the client's error mapping — is the real implementation.
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiBaseUrl: 'http://127.0.0.1:4001' } } },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

import type { EmergencyContact } from '@/core/types';
import { ApiError, BackendUnreachableError, apiFetch } from '@/services/api';
import { isDispatchedDelivery, useContactsStore } from '@/state/contacts-store';

const API_BASE = 'http://127.0.0.1:4001';
const TOKEN = 'test-token';

const CONTACT: EmergencyContact = {
  id: 'c_1',
  name: 'Mom',
  phone: '+919000000001',
  verified: false,
  createdAt: '2026-10-16T00:00:00.000Z',
};

const UNCONFIGURED =
  'No SMS provider is configured on the server, so no verification code was sent. ' +
  'Configure VIGILGRACE_SMS_PROVIDER (mock | twilio | webhook) on the backend.';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Replace global fetch for one test; nothing actually goes over a socket. */
function stubFetch(handler: () => Promise<Response> | Response) {
  const mock = vi.fn(async () => handler());
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

async function capture<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (err: unknown) => err,
  );
}

beforeEach(() => {
  useContactsStore.setState({
    contacts: [{ ...CONTACT }],
    error: null,
    pendingVerify: null,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('transport failure vs API error', () => {
  it('reports an unreachable backend as a transport failure, not an API error', async () => {
    stubFetch(() => {
      throw new TypeError('Network request failed');
    });

    const failure = await capture(apiFetch('/health'));

    expect(failure).toBeInstanceOf(BackendUnreachableError);
    expect(failure).not.toBeInstanceOf(ApiError);
    expect((failure as BackendUnreachableError).baseUrl).toBe(API_BASE);
    expect((failure as Error).message).toMatch(/nothing was sent/i);
    expect((failure as Error).message).toContain(API_BASE);
  });

  it('still surfaces the server reason for real HTTP errors', async () => {
    stubFetch(() => jsonResponse(401, { error: 'Not signed in.' }));

    const failure = await capture(apiFetch('/me', { token: TOKEN }));

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).not.toBeInstanceOf(BackendUnreachableError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as Error).message).toBe('Not signed in.');
  });

  it('keeps the provider verdict and status on the ApiError so callers can branch', async () => {
    stubFetch(() => jsonResponse(503, { error: UNCONFIGURED, delivery: 'unknown' }));

    const failure = await capture(
      apiFetch(`/contacts/${CONTACT.id}/send-verify`, { method: 'POST', token: TOKEN }),
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(503);
    expect((failure as ApiError).body).toEqual({ error: UNCONFIGURED, delivery: 'unknown' });
  });
});

describe('requesting a verification code', () => {
  it('says the backend was unreachable and sends nothing', async () => {
    stubFetch(() => {
      throw new TypeError('Network request failed');
    });

    const result = await useContactsStore.getState().sendVerification(TOKEN, CONTACT.id);
    const state = useContactsStore.getState();

    expect(result).toBeNull();
    expect(state.pendingVerify).toBeNull();
    expect(state.error).toContain(`Cannot reach the VigilGrace backend at ${API_BASE}`);
    expect(state.error).toMatch(/nothing was sent/i);
    // The contact must not be marked as "verification requested".
    expect(state.contacts[0]!.verifyRequestedAt).toBeUndefined();
  });

  it('surfaces the server reason when no SMS provider is configured', async () => {
    stubFetch(() => jsonResponse(503, { error: UNCONFIGURED, delivery: 'unknown' }));

    const result = await useContactsStore.getState().sendVerification(TOKEN, CONTACT.id);
    const state = useContactsStore.getState();

    expect(result).toBeNull();
    // The old behaviour was a blanket "SMS service is unavailable or not configured"
    // guess plus a code-entry prompt. Now the server's own reason is shown verbatim,
    // and no code is asked for because none was sent.
    expect(state.error).toBe(UNCONFIGURED);
    expect(state.pendingVerify).toBeNull();
    expect(state.contacts[0]!.verifyRequestedAt).toBeUndefined();
  });

  it('treats a 200 response with delivery "unknown" as "nothing was sent"', async () => {
    stubFetch(() => jsonResponse(200, { delivery: 'unknown' }));

    const result = await useContactsStore.getState().sendVerification(TOKEN, CONTACT.id);
    const state = useContactsStore.getState();

    expect(result).toBeNull();
    expect(state.pendingVerify).toBeNull();
    expect(state.error).toMatch(/did not send a verification code \(delivery: unknown\)/);
    expect(state.contacts[0]!.verifyRequestedAt).toBeUndefined();
  });

  it('enters code entry only once a provider accepted the code (twilio)', async () => {
    stubFetch(() => jsonResponse(200, { delivery: 'twilio' }));

    const result = await useContactsStore.getState().sendVerification(TOKEN, CONTACT.id);
    const state = useContactsStore.getState();

    expect(result).toEqual({ delivery: 'twilio' });
    expect(state.error).toBeNull();
    expect(state.pendingVerify).toEqual({
      contactId: CONTACT.id,
      delivery: 'twilio',
      devCode: undefined,
    });
    expect(state.contacts[0]!.verifyRequestedAt).toEqual(expect.any(String));
  });

  it('carries the dev code through in mock mode only', async () => {
    // Fabricated stub value — the real backend only returns this in dev mock mode.
    stubFetch(() => jsonResponse(200, { delivery: 'mock', devCode: '111222' }));

    await useContactsStore.getState().sendVerification(TOKEN, CONTACT.id);
    const state = useContactsStore.getState();

    expect(state.pendingVerify).toMatchObject({ delivery: 'mock', devCode: '111222' });
    expect(state.error).toBeNull();
  });

  it('reports the resend cooldown without fabricating a pending code', async () => {
    stubFetch(() =>
      jsonResponse(429, { error: 'Verification requested too recently — try again later' }),
    );

    const result = await useContactsStore.getState().sendVerification(TOKEN, CONTACT.id);
    const state = useContactsStore.getState();

    expect(result).toBeNull();
    expect(state.pendingVerify).toBeNull();
    expect(state.error).toBe('Verification requested too recently — try again later');
  });

  it('surfaces an auth failure instead of implying a code was sent', async () => {
    stubFetch(() => jsonResponse(401, { error: 'Not signed in.' }));

    const result = await useContactsStore.getState().sendVerification(TOKEN, CONTACT.id);
    const state = useContactsStore.getState();

    expect(result).toBeNull();
    expect(state.pendingVerify).toBeNull();
    expect(state.error).toBe('Not signed in.');
  });
});

describe('isDispatchedDelivery', () => {
  it('trusts only the modes that actually carry a code', () => {
    expect(['mock', 'twilio', 'webhook'].every(isDispatchedDelivery)).toBe(true);
    expect(isDispatchedDelivery('unknown')).toBe(false);
    expect(isDispatchedDelivery('')).toBe(false);
  });
});
