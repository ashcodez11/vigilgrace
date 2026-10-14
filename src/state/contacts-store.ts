/**
 * Emergency contacts store — server-backed CRUD + verification flow.
 */

import { create } from 'zustand';

import type { ContactSeed, EmergencyContact } from '@/core/types';
import {
  createContact,
  deleteContact,
  listContacts,
  requestContactVerification,
  updateContact,
  verifyContact,
  type SendVerifyResponse,
} from '@/services/backend';
import { ApiError } from '@/services/api';

interface ContactsState {
  contacts: EmergencyContact[];
  loading: boolean;
  error: string | null;
  pendingVerify: { contactId: string; delivery: string; devCode?: string } | null;

  refresh: (token: string) => Promise<void>;
  seedFromConfig: (token: string, seeds: ContactSeed[]) => Promise<void>;
  add: (token: string, input: { name: string; phone: string; relation?: string }) => Promise<void>;
  edit: (
    token: string,
    id: string,
    input: { name?: string; phone?: string; relation?: string },
  ) => Promise<void>;
  remove: (token: string, id: string) => Promise<void>;
  sendVerification: (token: string, id: string) => Promise<SendVerifyResponse | null>;
  confirmVerification: (token: string, id: string, code: string) => Promise<boolean>;
  clearPendingVerify: () => void;
  reset: () => void;
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  loading: false,
  error: null,
  pendingVerify: null,

  refresh: async (token) => {
    set({ loading: true, error: null });
    try {
      const { contacts } = await listContacts(token);
      set({ contacts, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  seedFromConfig: async (token, seeds) => {
    // Only seed when the account has no contacts yet (idempotent on re-login).
    try {
      const { contacts: existing } = await listContacts(token);
      if (existing.length > 0) {
        set({ contacts: existing });
        return;
      }
    } catch {
      // fall through and attempt seeding
    }
    const created: EmergencyContact[] = [];
    for (const seed of seeds) {
      try {
        const { contact } = await createContact(token, seed);
        created.push(contact);
      } catch {
        // skip invalid/duplicate seeds — user can add manually
      }
    }
    set({ contacts: created });
  },

  add: async (token, input) => {
    set({ error: null });
    try {
      const { contact } = await createContact(token, input);
      set({ contacts: [...get().contacts, contact] });
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  edit: async (token, id, input) => {
    set({ error: null });
    try {
      const { contact } = await updateContact(token, id, input);
      set({ contacts: get().contacts.map((c) => (c.id === id ? contact : c)) });
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  remove: async (token, id) => {
    set({ error: null });
    try {
      await deleteContact(token, id);
      set({ contacts: get().contacts.filter((c) => c.id !== id) });
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  sendVerification: async (token, id) => {
    set({ error: null });
    try {
      const response = await requestContactVerification(token, id);
      set({
        pendingVerify: {
          contactId: id,
          delivery: response.delivery,
          devCode: response.devCode,
        },
        contacts: get().contacts.map((c) =>
          c.id === id ? { ...c, verifyRequestedAt: new Date().toISOString() } : c,
        ),
      });
      return response;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        set({ error: 'Verification requested too recently — try again later' });
        return null;
      }
      set({ error: (err as Error).message });
      return null;
    }
  },

  confirmVerification: async (token, id, code) => {
    set({ error: null });
    try {
      const { contact } = await verifyContact(token, id, code.trim());
      set({
        contacts: get().contacts.map((c) => (c.id === id ? contact : c)),
        pendingVerify: null,
      });
      return true;
    } catch (err) {
      set({ error: (err as Error).message });
      return false;
    }
  },

  clearPendingVerify: () => set({ pendingVerify: null }),
  reset: () => set({ contacts: [], loading: false, error: null, pendingVerify: null }),
}));
