/**
 * Persistence: a single JSON document on disk (backend/server/data/db.json by
 * default). Small, dependency-free and easy to inspect/back up. Pass
 * `{ file: null }` for an in-memory store (used by tests).
 *
 * Secrets never live here in the clear beyond what the design requires: users
 * keep scrypt password hashes and token digests, verification records keep
 * salted code digests only. `serverKeys` holds the backend's own post-quantum
 * keypair (it must be able to open sealed alert envelopes) and `alerts` keeps
 * the received envelopes, which are ciphertext, not plaintext.
 *
 * The file is written 0600 and backend/server/data/ is gitignored. Prefer
 * configuring VIGILGRACE_SERVER_KEY_SEED instead of persisting server keys.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const EMPTY = {
  users: [],
  contacts: [],
  verifications: [],
  sessions: [],
  alerts: [],
  serverKeys: null,
};

export function createStore({ file = null } = {}) {
  let db = structuredClone(EMPTY);

  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      db = { ...structuredClone(EMPTY), ...parsed };
    } catch {
      // first run: start empty
    }
  }

  const persist = () => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };

  return {
    get data() {
      return db;
    },
    save: persist,
    /** Test helper: wipe everything. */
    reset() {
      db = structuredClone(EMPTY);
      persist();
    },
  };
}
