/**
 * Minimal typed HTTP client for the VigilGrace backend.
 *
 * Transport security: the backend is expected to be served over HTTPS in any
 * deployment. Local development uses plain HTTP on the LAN/emulator only —
 * the security status screen reports the active scheme so the user can see it.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getSecureItem, setSecureItem } from './secure-store';

const API_URL_OVERRIDE_KEY = 'apiBaseUrlOverride';

/** Port the bundled backend listens on (backend/server/src/index.js). */
export const DEFAULT_BACKEND_PORT = 4001;

/** The Android emulator's alias for the host machine's loopback interface. */
export const ANDROID_EMULATOR_HOST = '10.0.2.2';

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
        (detail ? `(${detail}) ` : '') +
        'Start it on the computer that runs the app ("npm run backend:start"). A phone or ' +
        'emulator cannot use the computer\'s "localhost", and 10.0.2.2 only exists inside the ' +
        'Android emulator: on a physical phone use the computer\'s LAN address, e.g. ' +
        'http://192.168.1.20:4001, via EXPO_PUBLIC_API_URL or the backend URL override in ' +
        'Settings, then retry.',
    );
    this.name = 'BackendUnreachableError';
  }
}

function configuredBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const fromExtra = typeof extra?.apiBaseUrl === 'string' ? extra.apiBaseUrl : null;
  return fromExtra ?? process.env.EXPO_PUBLIC_API_URL ?? `http://localhost:${DEFAULT_BACKEND_PORT}`;
}

/**
 * Host the Expo dev server advertises, e.g. `192.168.1.20:8081`.
 *
 * This is the single most useful fact for a physical phone: Metro can only be
 * reached from the handset at a LAN address, so that same address (with the
 * backend's port) reaches the Mac's backend. Null when running a build with no
 * dev server attached (a release/preview APK) — then the URL must be explicit.
 */
export function devServerHostname(): string | null {
  const expoConfig = Constants.expoConfig as { hostUri?: string } | null;
  const expoGoConfig = Constants.expoGoConfig as { debuggerHost?: string } | null;
  const raw = expoConfig?.hostUri ?? expoGoConfig?.debuggerHost ?? null;
  if (typeof raw !== 'string') return null;
  const withoutScheme = raw.trim().replace(/^[a-z]+:\/\//i, '');
  const hostAndPort = withoutScheme.split('/')[0] ?? '';
  // Strip the dev server port; keep IPv6 literals intact (they are bracketed).
  const host = hostAndPort.startsWith('[')
    ? hostAndPort.slice(0, hostAndPort.indexOf(']') + 1)
    : (hostAndPort.split(':')[0] ?? '');
  return host || null;
}

/** Loopback names that only ever mean "this device", never "the computer". */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '::1'
  );
}

/**
 * Addresses that mean "the computer" only from a simulator/emulator: loopback
 * names, plus the Android emulator's 10.0.2.2 alias. A saved Settings override
 * holding 10.0.2.2 is just as dead on a handset as localhost is, so both are
 * rewritten the same way.
 */
export function isHostMachineAlias(hostname: string): boolean {
  return isLoopbackHostname(hostname) || hostname === ANDROID_EMULATOR_HOST;
}

/**
 * A dev-server host the backend can be assumed to share: an IP literal or an
 * mDNS name. A tunnel hostname (`*.exp.direct`) only forwards Metro's port, so
 * reusing it for the backend would just move the failure — better to report
 * "no LAN address known" than to guess.
 */
export function isLanReachableHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isHostMachineAlias(host)) return false;
  if (host.endsWith('.local')) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (octets) return octets.slice(1).every((part) => Number(part) <= 255);
  return host.includes(':') && /^[0-9a-f:]+$/.test(host);
}

/** Facts about the runtime that decide how a base URL must be rewritten. */
export interface ApiResolutionContext {
  platform: string;
  /** False on an emulator/simulator, where loopback aliases do exist. */
  isPhysicalDevice: boolean;
  devServerHost: string | null;
}

export function resolveApiContext(): ApiResolutionContext {
  return {
    platform: Platform.OS,
    // Device.isDevice is false on emulators/simulators and true on handsets.
    isPhysicalDevice: Device.isDevice !== false,
    devServerHost: devServerHostname(),
  };
}

/**
 * Turn the configured URL into the URL this device can actually reach.
 *
 * The old rule was "any loopback URL on Android becomes 10.0.2.2". That is
 * correct for the emulator and wrong everywhere else: on a physical handset
 * `localhost` is the phone and `10.0.2.2` is a dead address, so the app could
 * never reach the backend no matter that Metro was running fine.
 *
 * Now:
 *   - a non-loopback URL (an explicit LAN/HTTPS address) is used verbatim;
 *   - Android emulator: loopback -> 10.0.2.2 (unchanged behaviour);
 *   - physical Android/iOS on a dev build: loopback -> the LAN host Metro is
 *     already reachable at, keeping the configured backend port;
 *   - otherwise the URL is left alone and the caller shows the honest
 *     connection failure instead of inventing an address.
 */
export function resolveApiBaseUrl(
  configured = configuredBaseUrl(),
  context: ApiResolutionContext = resolveApiContext(),
): string {
  const url = configured.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!isHostMachineAlias(parsed.hostname)) return url;

  const host = context.devServerHost;
  const lanHost = host && isLanReachableHost(host) ? host : null;

  if (context.platform === 'android') {
    parsed.hostname = context.isPhysicalDevice ? (lanHost ?? parsed.hostname) : ANDROID_EMULATOR_HOST;
  } else if (context.platform === 'ios' && context.isPhysicalDevice) {
    if (lanHost) parsed.hostname = lanHost;
  }
  return parsed.toString().replace(/\/+$/, '');
}

/** What the app will call, and why — for the Settings and security screens. */
export interface ApiTargetInfo {
  baseUrl: string;
  source: 'override' | 'config';
  devServerHost: string | null;
  /** Set when the resolved URL still cannot work from a phone. */
  warning: string | null;
}

function targetWarning(baseUrl: string, context: ApiResolutionContext): string | null {
  try {
    if (!isHostMachineAlias(new URL(baseUrl).hostname)) return null;
  } catch {
    return null;
  }
  if (context.platform === 'web' || !context.isPhysicalDevice) return null;
  return (
    `This device is a physical phone, so "${baseUrl}" points at the phone itself, not at the ` +
    'computer. Start Expo on the LAN (not --localhost/--tunnel) so the address can be derived ' +
    `automatically, or set the computer's LAN URL (e.g. http://192.168.1.20:${DEFAULT_BACKEND_PORT}).`
  );
}

export async function getApiTarget(): Promise<ApiTargetInfo> {
  const override = await getSecureItem(API_URL_OVERRIDE_KEY);
  const source: ApiTargetInfo['source'] = override ? 'override' : 'config';
  const context = resolveApiContext();
  const baseUrl = resolveApiBaseUrl(override ?? configuredBaseUrl(), context);
  return {
    baseUrl,
    source,
    devServerHost: context.devServerHost,
    warning: targetWarning(baseUrl, context),
  };
}

export async function getApiBaseUrl(): Promise<string> {
  return (await getApiTarget()).baseUrl;
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
