/**
 * Post-quantum identity key management.
 *
 * Only the 32/64-byte noble *seeds* are persisted in SecureStore (small,
 * single chunk); full ML-KEM/ML-DSA key material is re-derived on demand with
 * deterministic keygen. Private keys never touch disk in plaintext beyond the
 * platform keystore (iOS Keychain / Android EncryptedSharedPreferences) and
 * never leave the device.
 */

import { toBase64, fromBase64, type RandomSource } from '@/core/crypto/bytes';
import {
  type SignatureKeyPair,
  type KemKeyPair,
  generateKemKeyPair,
  generateSignatureKeyPair,
} from '@/core/crypto/pqc';
import { cryptoRandom } from './random';
import { deleteSecureItem, getSecureItem, setSecureItem } from './secure-store';

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

const KEM_SEED_KEY = 'pq_kem_seed';
const DSA_SEED_KEY = 'pq_dsa_seed';
const SERVER_KEYS_KEY = 'server_pq_keys';
const LAST_SERVER_URL_KEY = 'server_pq_keys_url';

export interface CachedServerKeys {
  kemPublicKeyB64: string;
  sigPublicKeyB64: string;
  fetchedAt: string;
}

export interface Identity {
  kem: KemKeyPair;
  dsa: SignatureKeyPair;
  kemPublicKeyB64: string;
  dsaPublicKeyB64: string;
  /** True when keys were newly generated on this call. */
  created: boolean;
}

function generateSeed(length: number, random: RandomSource): Uint8Array {
  return random(length);
}

export async function loadOrCreateIdentity(
  random: RandomSource = cryptoRandom,
): Promise<Identity> {
  let kemSeedB64 = await getSecureItem(KEM_SEED_KEY);
  let dsaSeedB64 = await getSecureItem(DSA_SEED_KEY);
  let created = false;

  if (!kemSeedB64 || !dsaSeedB64) {
    created = true;
    kemSeedB64 = toBase64(generateSeed(ml_kem768.lengths.seed!, random));
    dsaSeedB64 = toBase64(generateSeed(ml_dsa65.lengths.seed!, random));
    await setSecureItem(KEM_SEED_KEY, kemSeedB64);
    await setSecureItem(DSA_SEED_KEY, dsaSeedB64);
  }

  const kem = ml_kem768.keygen(fromBase64(kemSeedB64));
  const dsa = ml_dsa65.keygen(fromBase64(dsaSeedB64));
  return {
    kem: { publicKey: kem.publicKey, secretKey: kem.secretKey },
    dsa: { publicKey: dsa.publicKey, secretKey: dsa.secretKey },
    kemPublicKeyB64: toBase64(kem.publicKey),
    dsaPublicKeyB64: toBase64(dsa.publicKey),
    created,
  };
}

export async function clearIdentity(): Promise<void> {
  await deleteSecureItem(KEM_SEED_KEY);
  await deleteSecureItem(DSA_SEED_KEY);
  await deleteSecureItem(SERVER_KEYS_KEY);
  await deleteSecureItem(LAST_SERVER_URL_KEY);
}

export async function cacheServerKeys(keys: CachedServerKeys, serverUrl: string): Promise<void> {
  await setSecureItem(SERVER_KEYS_KEY, JSON.stringify(keys));
  await setSecureItem(LAST_SERVER_URL_KEY, serverUrl);
}

export async function getCachedServerKeys(): Promise<CachedServerKeys | null> {
  const raw = await getSecureItem(SERVER_KEYS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedServerKeys;
  } catch {
    return null;
  }
}
