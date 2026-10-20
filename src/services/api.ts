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

/**
 * The request never produced an HTTP response: the backend is not running, is
 * unreachable from this device, or the network dropped it.
 *
 * This is deliberately a *different* type from ApiError. Conflating the two is
 * what made the verification flow report a configuration problem for a network
 * failure (and vice versa): the server's own reason was discarded and replaced
 * with a guess. Callers can now branch on `instanceof` and say what is true —
 * nothing was sent, because nothing answered.
 */
export class BackendUnreachableError extends Error {
  constructor(
    readonly baseUrl: string,
    readonly detail?: string,
  ) {
    super(
      `Cannot reach the VigilGrace backend at ${baseUrl}, so nothing was sent. ` +
        'Start the backend ("npm run backend:start") or point the app at a reachable ' +
        'server with EXPO_PUBLIC_API_URL / extra.apiBaseUrl, then retry.',
    );
    this.name = 'BackendUnreachableError';
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
  /**
   * Hard limit for the whole request. A hung socket must not leave an SOS in
   * "sending" forever: the caller needs a failure it can retry.
   */
  timeoutMs?: number;
}

/** Default ceiling for ordinary API calls; SOS dispatch passes its own. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = await getApiBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort);

  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (err) {
    // A caller-initiated cancellation is not a transport verdict.
    if (options.signal?.aborted) throw err;
    const detail = timedOut
      ? `the server did not answer within ${Math.round(timeoutMs / 1000)}s`
      : err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
    throw new BackendUnreachableError(base, detail);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }

  let payload: unknown = null;
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
