/**
 * Minimal typed HTTP client for the VigilGrace backend.
 *
 * Transport security: the backend is expected to be served over HTTPS in any
 * deployment. Local development uses plain HTTP on the LAN/emulator only —
 * the security status screen reports the active scheme so the user can see it.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getSecureItem, setSecureItem } from './secure-store';

const API_URL_OVERRIDE_KEY = 'apiBaseUrlOverride';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function configuredBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const fromExtra = typeof extra?.apiBaseUrl === 'string' ? extra.apiBaseUrl : null;
  return fromExtra ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4001';
}

/** Map loopback to the Android emulator host alias when needed. */
export function resolveApiBaseUrl(configured = configuredBaseUrl()): string {
  const url = configured.replace(/\/+$/, '');
  if (Platform.OS !== 'android') return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = '10.0.2.2';
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    // not a parseable URL — return as-is
  }
  return url;
}

export async function getApiBaseUrl(): Promise<string> {
  const override = await getSecureItem(API_URL_OVERRIDE_KEY);
  return resolveApiBaseUrl(override ?? configuredBaseUrl());
}

export async function setApiBaseUrlOverride(value: string | null): Promise<void> {
  if (value === null) {
    const { deleteSecureItem } = await import('./secure-store');
    await deleteSecureItem(API_URL_OVERRIDE_KEY);
    return;
  }
  await setSecureItem(API_URL_OVERRIDE_KEY, value.replace(/\/+$/, ''));
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = await getApiBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: string }).error === 'string'
        ? (payload as { error: string }).error
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}
