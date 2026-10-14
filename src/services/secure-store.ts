/**
 * Chunked SecureStore wrapper.
 *
 * iOS keychain values above ~2 KB can be rejected by some system versions and
 * Android EncryptedSharedPreferences values are also limited in practice.
 * Post-quantum private keys are several KB (ML-KEM-768 sk = 2400 B,
 * ML-DSA-65 sk = 4032 B → ~5.4 KB base64), so values are split into small
 * chunks stored under derived keys with a manifest.
 *
 * Keys are limited to [A-Za-z0-9._-] by expo-secure-store.
 */

import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1200;
const KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

function partKey(key: string, index: number): string {
  return `${key}__p${index}`;
}

const metaKey = (key: string) => `${key}__meta`;

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
      await SecureStore.deleteItemAsync(partKey(key, i));
    }
  }
  for (let i = 0; i < parts.length; i += 1) {
    await SecureStore.setItemAsync(partKey(key, i), parts[i]!);
  }
  await SecureStore.setItemAsync(metaKey(key), String(parts.length));
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid SecureStore key: ${key}`);
  const count = await readMeta(key);
  if (count === null) return null;
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const part = await SecureStore.getItemAsync(partKey(key, i));
    if (part === null) {
      // Chunks missing → fall back to an un-chunked legacy value if present.
      return SecureStore.getItemAsync(key);
    }
    out += part;
  }
  return out;
}

export async function deleteSecureItem(key: string): Promise<void> {
  const count = await readMeta(key);
  if (count !== null) {
    for (let i = 0; i < count; i += 1) {
      await SecureStore.deleteItemAsync(partKey(key, i));
    }
  }
  await SecureStore.deleteItemAsync(metaKey(key));
  await SecureStore.deleteItemAsync(key);
}

async function readMeta(key: string): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(metaKey(key));
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  // Backwards compatibility: un-chunked legacy value.
  const legacy = await SecureStore.getItemAsync(key);
  return legacy !== null ? 1 : null;
}
