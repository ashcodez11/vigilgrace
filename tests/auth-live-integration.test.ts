/**
 * OPT-IN live registration/login test: the app's real HTTP client against a real
 * running VigilGrace backend. Nothing is stubbed except the Expo/React Native
 * modules that cannot load under Node.
 *
 * Skipped by default so `npm test` stays self-contained. To run it:
 *
 *   1. npm run backend:start
 *   2. VIGILGRACE_LIVE_BASE=http://192.168.1.2:4001 \
 *      npx vitest run tests/auth-live-integration.test.ts
 *
 * Use the LAN address (not 127.0.0.1) to exercise the same route a physical
 * phone takes. The test account is created fresh per run; its password is a
 * throwaway literal and the issued tokens are never printed.
 */
import { describe, expect, it, vi } from 'vitest';

const LIVE_BASE = process.env.VIGILGRACE_LIVE_BASE ?? '';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiBaseUrl: process.env.VIGILGRACE_LIVE_BASE ?? '' } } },
}));
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

import { fetchMe, loginUser, registerUser, uploadPublicKeys } from '@/services/backend';
import { ApiError } from '@/services/api';

const TEST_PASSWORD = 'local-verification-passphrase';

function uniqueEmail(): string {
  return `live.auth.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function capture<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (err: unknown) => err,
  );
}

describe('live registration/login against the real backend (opt-in)', () => {
  it.skipIf(!LIVE_BASE)('registers, authenticates and logs in over the LAN address', async () => {
    const email = uniqueEmail();

    const registered = await registerUser(email, TEST_PASSWORD, 'Live Auth Check');
    expect(registered.token).toBeTruthy();
    expect(registered.user.email).toBe(email);
    expect(registered.user.id).toBeTruthy();

    // The session token issued at registration must authenticate subsequent calls.
    const me = await fetchMe(registered.token);
    expect(me.user.id).toBe(registered.user.id);

    // Post-registration key upload is part of the real flow; public values only.
    const uploaded = await uploadPublicKeys(registered.token, {
      mlKemPublicKeyB64: 'dGVzdC1rZW0tcHVibGljLWtleQ==',
      mlDsaPublicKeyB64: 'dGVzdC1kc2EtcHVibGljLWtleQ==',
    });
    expect(uploaded.ok).toBe(true);

    const loggedIn = await loginUser(email, TEST_PASSWORD);
    expect(loggedIn.token).toBeTruthy();
    expect(loggedIn.token).not.toBe(registered.token);
    expect(loggedIn.user.id).toBe(registered.user.id);
  });

  it.skipIf(!LIVE_BASE)('rejects a wrong password without revealing whether the account exists', async () => {
    const email = uniqueEmail();
    await registerUser(email, TEST_PASSWORD, 'Live Auth Check');

    const wrongPassword = await capture(loginUser(email, 'definitely-not-the-password'));
    expect(wrongPassword).toBeInstanceOf(ApiError);
    expect((wrongPassword as ApiError).status).toBe(401);

    const unknownUser = await capture(loginUser(uniqueEmail(), TEST_PASSWORD));
    expect(unknownUser).toBeInstanceOf(ApiError);
    expect((unknownUser as ApiError).status).toBe(401);
    // Identical message: no account enumeration.
    expect((unknownUser as Error).message).toBe((wrongPassword as Error).message);
  });

  it.skipIf(!LIVE_BASE)('refuses a duplicate registration with 409', async () => {
    const email = uniqueEmail();
    await registerUser(email, TEST_PASSWORD, 'Live Auth Check');

    const duplicate = await capture(registerUser(email, TEST_PASSWORD, 'Live Auth Check'));
    expect(duplicate).toBeInstanceOf(ApiError);
    expect((duplicate as ApiError).status).toBe(409);
  });

  it.skipIf(!LIVE_BASE)('enforces the password policy on the server, not only in the UI', async () => {
    const tooShort = await capture(registerUser(uniqueEmail(), 'short', 'Live Auth Check'));
    expect(tooShort).toBeInstanceOf(ApiError);
    expect((tooShort as ApiError).status).toBe(400);
  });
});
