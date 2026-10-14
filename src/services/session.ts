/**
 * Session persistence: auth token + profile in SecureStore.
 */

import type { UserProfile } from '@/core/types';
import { deleteSecureItem, getSecureItem, setSecureItem } from './secure-store';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export async function saveSession(token: string, user: UserProfile): Promise<void> {
  await setSecureItem(TOKEN_KEY, token);
  await setSecureItem(USER_KEY, JSON.stringify(user));
}

export async function loadSession(): Promise<{ token: string; user: UserProfile } | null> {
  const token = await getSecureItem(TOKEN_KEY);
  const userRaw = await getSecureItem(USER_KEY);
  if (!token || !userRaw) return null;
  try {
    return { token, user: JSON.parse(userRaw) as UserProfile };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await deleteSecureItem(TOKEN_KEY);
  await deleteSecureItem(USER_KEY);
}
