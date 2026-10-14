/**
 * Auth session store: register / login / logout with server + PQ key setup.
 */

import Constants from 'expo-constants';
import { create } from 'zustand';

import { sanitizeContactSeeds } from '@/core/contacts/contacts';
import type { UserProfile } from '@/core/types';
import {
  loginUser,
  registerUser,
  uploadPublicKeys,
  type AuthResponse,
} from '@/services/backend';
import { clearIdentity, loadOrCreateIdentity } from '@/services/identity-keys';
import { clearSession, loadSession, saveSession } from '@/services/session';
import { useContactsStore } from './contacts-store';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  user: UserProfile | null;
  token: string | null;
  error: string | null;
  busy: boolean;
  bootstrap: () => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

function initialContactsFromConfig() {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  return sanitizeContactSeeds(extra?.initialContacts ?? []);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  token: null,
  error: null,
  busy: false,

  bootstrap: async () => {
    const session = await loadSession();
    if (session) {
      set({ status: 'signedIn', token: session.token, user: session.user, error: null });
      void useContactsStore.getState().refresh(session.token);
    } else {
      set({ status: 'signedOut', token: null, user: null });
    }
  },

  register: async (email, password, name) => {
    set({ busy: true, error: null });
    try {
      const response: AuthResponse = await registerUser(email, password, name);
      await saveSession(response.token, response.user);

      // Post-quantum identity: generate locally, publish ONLY public keys.
      const identity = await loadOrCreateIdentity();
      await uploadPublicKeys(response.token, {
        mlKemPublicKeyB64: identity.kemPublicKeyB64,
        mlDsaPublicKeyB64: identity.dsaPublicKeyB64,
      });

      // Seed the initial emergency contacts from private local config.
      const seeds = initialContactsFromConfig();
      await useContactsStore.getState().seedFromConfig(response.token, seeds);

      set({
        status: 'signedIn',
        token: response.token,
        user: { ...response.user, mlKemPublicKeyB64: identity.kemPublicKeyB64 },
        busy: false,
      });
    } catch (err) {
      set({ busy: false, error: (err as Error).message });
      throw err;
    }
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const response = await loginUser(email, password);
      await saveSession(response.token, response.user);
      const identity = await loadOrCreateIdentity();
      await uploadPublicKeys(response.token, {
        mlKemPublicKeyB64: identity.kemPublicKeyB64,
        mlDsaPublicKeyB64: identity.dsaPublicKeyB64,
      });
      set({
        status: 'signedIn',
        token: response.token,
        user: response.user,
        busy: false,
      });
      void useContactsStore.getState().refresh(response.token);
    } catch (err) {
      set({ busy: false, error: (err as Error).message });
      throw err;
    }
  },

  logout: async () => {
    await clearSession();
    // Keep PQ identity across logouts on the same device? Safer to drop it.
    await clearIdentity();
    useContactsStore.getState().reset();
    set({ status: 'signedOut', token: null, user: null, error: null, busy: false });
  },

  clearError: () => set({ error: null }),
}));
