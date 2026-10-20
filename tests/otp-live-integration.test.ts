/**
 * OPT-IN live integration test: the app's real store and HTTP client talking to a
 * real running VigilGrace backend over real HTTP. No `fetch` stubbing — only the
 * three Expo/React Native modules that cannot load under Node are replaced.
 *
 * It is skipped unless a server is available, so `npm test` stays self-contained:
 *
 *   1. npm run backend:start          # or: VIGILGRACE_SMS_PROVIDER=mock VIGILGRACE_ALLOW_MOCK=1 npm run backend:start
 *   2. VIGILGRACE_LIVE_BASE=http://127.0.0.1:4001 npx vitest run tests/otp-live-integration.test.ts
 *
 * A failed run here means the client and server disagree about the contract or
 * the error mapping — the two things that made the original OTP failure unreadable.
 * The verification code is never printed.
 */
import { describe, expect, it, vi } from 'vitest';

const LIVE_BASE = process.env.VIGILGRACE_LIVE_BASE ?? '';
const CLOSED_PORT_BASE = 'http://127.0.0.1:4299'; // deliberately nothing listening

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiBaseUrl: process.env.VIGILGRACE_LIVE_BASE ?? '' } } },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

import Constants from 'expo-constants';
import { createContact, registerUser } from '@/services/backend';
import { useContactsStore } from '@/state/contacts-store';

// No real handset number belongs in the repo: supply VIGILGRACE_LIVE_PHONE when
// deliberately running this opt-in test against a provider.
const OWNER_PHONE = process.env.VIGILGRACE_LIVE_PHONE ?? '+919000000001';

function setBase(url: string) {
  (Constants.expoConfig!.extra as Record<string, string>).apiBaseUrl = url;
}

describe('live client -> server integration (opt-in)', () => {
  it.skipIf(!LIVE_BASE)(
    'dispatches and verifies a code through the real store against the running server',
    async () => {
      setBase(LIVE_BASE);

      const registered = await registerUser(
        `live.${Date.now()}@example.test`,
        'a-long-passphrase',
        'Live Trace',
      );
      expect(registered.token).toBeTruthy();

      const { contact } = await createContact(registered.token, {
        name: 'Owner test handset',
        phone: OWNER_PHONE,
      });
      expect(contact.phone).toBe(OWNER_PHONE);

      const sent = await useContactsStore.getState().sendVerification(registered.token, contact.id);
      expect(sent?.delivery).toBeDefined();
      const state = useContactsStore.getState();
      if (sent?.delivery === 'unknown') {
        // Server has no provider configured: the true reason must be shown and no
        // code-entry state invented. Nothing to verify further here.
        expect(state.pendingVerify).toBeNull();
        expect(state.error).toMatch(/provider/i);
        return;
      }
      expect(state.pendingVerify?.contactId).toBe(contact.id);

      const code = sent?.devCode ?? process.env.VIGILGRACE_LIVE_CODE;
      if (!code) {
        // A real provider was used: there is no code to read back here, and this
        // test must never guess or fabricate one.
        expect(state.error).toBeNull();
        return;
      }

      const confirmed = await useContactsStore
        .getState()
        .confirmVerification(registered.token, contact.id, code);
      expect(confirmed).toBe(true);

      // Read the authoritative state back from the server through the store.
      await useContactsStore.getState().refresh(registered.token);
      expect(useContactsStore.getState().contacts.find((c) => c.id === contact.id)?.verified).toBe(
        true,
      );

      // A verified contact must not be sent another code, and the client must not
      // pretend one is on its way.
      const afterVerify = await useContactsStore
        .getState()
        .sendVerification(registered.token, contact.id);
      expect(afterVerify).toBeNull();
      expect(useContactsStore.getState().pendingVerify).toBeNull();
      expect(useContactsStore.getState().error).toMatch(/already verified/i);
    },
  );

  it('reports an unreachable backend truthfully when nothing is listening', async () => {
    setBase(CLOSED_PORT_BASE);
    useContactsStore.setState({ error: null, pendingVerify: null });

    const result = await useContactsStore.getState().sendVerification('token', 'c_1');
    const state = useContactsStore.getState();

    expect(result).toBeNull();
    expect(state.pendingVerify).toBeNull();
    expect(state.error).toContain(`Cannot reach the VigilGrace backend at ${CLOSED_PORT_BASE}`);
    expect(state.error).toMatch(/nothing was sent/i);
  });
});
