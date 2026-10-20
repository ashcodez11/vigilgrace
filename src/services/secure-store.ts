/**
 * Platform-aware secure storage adapter.
 *
 * Native (iOS/Android): Uses expo-secure-store (hardware-backed keychain/keystore)
 * Web: Falls back to sessionStorage for preview only - NOT for production
 *
 * SECURITY NOTE: Web storage is NOT secure. Use web preview only for development/demo.
 * Sensitive data (auth tokens, encryption keys) should never be stored in browser storage
 * in production. The native app is the only secure deployment target.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1200;
const KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

function partKey(key: string, index: number): string {
  return `${key}__p${index}`;
}

const metaKey = (key: string) => `${key}__meta`;

// Web fallback storage using sessionStorage (preview only)
const webStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Storage full or disabled - fail silently for web preview
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignore
    }
  },
};

// Platform-specific storage operations
const storage = {
  async getItemAsync(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return webStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage.setItem(key, value);
      return;
    }
    return SecureStore.setItemAsync(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      webStorage.removeItem(key);
      return;
    }
    return SecureStore.deleteItemAsync(key);
  },
};

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid SecureStore key: ${key}`);
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    parts.push(value.slice(i, i + CHUNK_SIZE));
  }
  // Remove any stale parts from a previous longer value.
  const existingCount = await readMeta(key);
  if (existingCount !== null) {
    for (let i = parts.length; i < existingCount; i += 1) {
      await storage.deleteItemAsync(partKey(key, i));
    }
  }
  for (let i = 0; i < parts.length; i += 1) {
    await storage.setItemAsync(partKey(key, i), parts[i]!);
  }
  await storage.setItemAsync(metaKey(key), String(parts.length));
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid SecureStore key: ${key}`);
  const count = await readMeta(key);
  if (count === null) return null;
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const part = await storage.getItemAsync(partKey(key, i));
    if (part === null) {
      // Chunks missing → fall back to an un-chunked legacy value if present.
      return storage.getItemAsync(key);
    }
    out += part;
  }
  return out;
}

export async function deleteSecureItem(key: string): Promise<void> {
  const count = await readMeta(key);
  if (count !== null) {
    for (let i = 0; i < count; i += 1) {
      await storage.deleteItemAsync(partKey(key, i));
    }
  }
  await storage.deleteItemAsync(metaKey(key));
  await storage.deleteItemAsync(key);
}

async function readMeta(key: string): Promise<number | null> {
  const raw = await storage.getItemAsync(metaKey(key));
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  // Backwards compatibility: un-chunked legacy value.
  const legacy = await storage.getItemAsync(key);
  return legacy !== null ? 1 : null;
}

/**
 * Check if the current platform supports secure storage.
 * Web returns false (uses insecure fallback for preview only).
 */
export function isSecureStorageAvailable(): boolean {
  return Platform.OS !== 'web';
}
