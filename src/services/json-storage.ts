/**
 * JSON file-backed StateStorage adapter for zustand persist.
 * Uses the expo-file-system sync File API (app-private document directory).
 */

import { File, Paths } from 'expo-file-system';
import type { StateStorage } from 'zustand/middleware';

function fileFor(name: string): File {
  return new File(Paths.document, `${name}.json`);
}

export const jsonFileStorage: StateStorage = {
  getItem(name) {
    try {
      const file = fileFor(name);
      return file.exists ? file.textSync() : null;
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      const file = fileFor(name);
      if (!file.exists) file.create();
      file.write(value);
    } catch {
      // storage failures must never crash the app
    }
  },
  removeItem(name) {
    try {
      const file = fileFor(name);
      if (file.exists) file.delete();
    } catch {
      // ignore
    }
  },
};
