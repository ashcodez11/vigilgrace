/**
 * SMS delivery adapters (verification codes + emergency alerts).
 *
 * The rule this module exists to enforce: nothing is ever reported as sent
 * unless a provider actually accepted it. If nothing is configured the caller
 * is told exactly that and NOTHING is sent.
 *
 * Modes (`VIGILGRACE_SMS_PROVIDER`):
 *   mock     — dev/demo only, and only with VIGILGRACE_ALLOW_MOCK=1. No SMS
 *              leaves the machine; results are labelled `simulated`.
 *   twilio   — needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or
 *              TWILIO_MESSAGING_SERVICE_SID).
 *   webhook  — needs VIGILGRACE_SMS_WEBHOOK_URL; POSTs JSON.
 *
 * With no explicit mode, twilio/webhook are auto-detected from their env vars.
 * Provider credentials are read from the environment only; none are ever
 * logged, and provider "accepted" is never reported as handset delivery.
 */

export const DELIVERY_MODES = Object.freeze(['mock', 'twilio', 'webhook', 'unknown']);

export class ProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

const PROVIDER_TIMEOUT_MS = 10_000;

export const UNCONFIGURED_MESSAGE =
  'No SMS provider is configured on the server, so no verification code was sent. ' +
  'Configure one of: VIGILGRACE_SMS_PROVIDER=mock with VIGILGRACE_ALLOW_MOCK=1 (dev only), ' +
  'twilio with TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM, or ' +
  'webhook with VIGILGRACE_SMS_WEBHOOK_URL.';

export const ALERT_UNCONFIGURED_MESSAGE =
  'No SMS provider is configured on the server, so no emergency message was sent to any contact. ' +
  'Configure VIGILGRACE_SMS_PROVIDER (mock | twilio | webhook) on the backend.';

function twilioReady(env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID),
  );
}

/** Resolve the active mode without contacting anything. */
export function resolveMode(env = process.env) {
  const explicit = String(env.VIGILGRACE_SMS_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'mock') {
    return String(env.VIGILGRACE_ALLOW_MOCK || '') === '1' ? 'mock' : 'unknown';
  }
  if (explicit === 'twilio') return twilioReady(env) ? 'twilio' : 'unknown';
  if (explicit === 'webhook') {
    return env.VIGILGRACE_SMS_WEBHOOK_URL ? 'webhook' : 'unknown';
  }
  if (twilioReady(env)) return 'twilio';
  if (env.VIGILGRACE_SMS_WEBHOOK_URL) return 'webhook';
  return 'unknown';
}

export function verificationMessage(code) {
  return `VigilGrace verification code: ${code}. Share it with the contact who requested verification. It expires in 10 minutes.`;
}

/** Emergency SMS body. Only what a responder needs — no digests, no internals. */
export function alertMessage({ userName, trigger, location }) {
  const who = userName ? userName : 'A VigilGrace user';
  const parts = [`VigilGrace SOS: ${who} triggered an emergency alert (${trigger}).`];
  if (location) {
    parts.push(
      `Location: https://maps.google.com/?q=${Number(location.latitude).toFixed(6)},${Number(
        location.longitude,
      ).toFixed(6)}`,
    );
  } else {
    parts.push('Location: not available.');
  }
  parts.push('Please try to reach them. If you cannot, contact local emergency services.');
  return parts.join(' ');
}

/** Shared Twilio POST. Returns provider acceptance, never handset delivery. */
async function postTwilioMessage(env, { to, body }) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const params = new URLSearchParams({ To: to, Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    params.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    params.set('From', env.TWILIO_FROM);
  }
  const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');

  let response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(`Twilio could not be reached (${err.name}).`);
  }
  if (!response.ok) {
    // Provider text is useful for the operator; it never contains the code.
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new ProviderError(`Twilio rejected the message (HTTP ${response.status}): ${detail}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload || (!payload.sid && payload.status !== 'queued')) {
    throw new ProviderError('Twilio accepted the connection but returned no message id.');
  }
  return { sid: payload.sid ?? null };
}

async function postWebhook(env, payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (env.VIGILGRACE_SMS_WEBHOOK_TOKEN) {
    headers.Authorization = `Bearer ${env.VIGILGRACE_SMS_WEBHOOK_TOKEN}`;
  }
  let response;
  try {
    response = await fetch(env.VIGILGRACE_SMS_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(`The SMS webhook could not be reached (${err.name}).`);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new ProviderError(`The SMS webhook rejected the message (HTTP ${response.status}): ${detail}`);
  }
}

/**
 * Dispatch a verification code. `code` is only ever handed to the provider (or
 * returned to the caller in mock mode); it is never logged.
 */
export async function dispatchVerificationCode(env, { to, code, contact }) {
  const mode = resolveMode(env);
  if (mode === 'unknown') throw new ProviderError(UNCONFIGURED_MESSAGE, 503);
  if (mode === 'mock') return { delivery: 'mock', devCode: code };
  if (mode === 'twilio') {
    await postTwilioMessage(env, { to, body: verificationMessage(code) });
    return { delivery: 'twilio' };
  }
  if (mode === 'webhook') {
    await postWebhook(env, {
      to,
      code,
      message: verificationMessage(code),
      purpose: 'emergency-contact-verification',
      contactId: contact.id,
    });
    return { delivery: 'webhook' };
  }
  throw new ProviderError(UNCONFIGURED_MESSAGE, 503);
}

/**
 * Dispatch one emergency alert message.
 *
 * Returns a delivery verdict the app can display honestly:
 *   state 'sent'      — the provider accepted the message (NOT handset delivery)
 *   state 'simulated' — mock mode; nothing left the machine
 *   state 'failed'    — nothing was sent, with the reason
 * Throws only for unexpected errors; provider failures come back as 'failed'.
 */
export async function dispatchAlertMessage(env, { to, text, meta = {} }) {
  const mode = resolveMode(env);
  if (mode === 'unknown') {
    return { delivery: 'unknown', state: 'failed', detail: ALERT_UNCONFIGURED_MESSAGE };
  }
  if (mode === 'mock') {
    return {
      delivery: 'mock',
      state: 'simulated',
      detail:
        'Mock mode (VIGILGRACE_ALLOW_MOCK=1): recorded and simulated — no SMS, call or push was sent.',
    };
  }
  try {
    if (mode === 'twilio') {
      const { sid } = await postTwilioMessage(env, { to, body: text });
      return {
        delivery: 'twilio',
        state: 'sent',
        detail: `Twilio accepted the message${sid ? ` (${String(sid).slice(0, 12)}…)` : ''}; handset delivery is not confirmed.`,
      };
    }
    await postWebhook(env, { to, message: text, purpose: 'emergency-alert', ...meta });
    return {
      delivery: 'webhook',
      state: 'sent',
      detail: 'The messaging gateway accepted the alert; handset delivery is not confirmed.',
    };
  } catch (err) {
    return { delivery: mode, state: 'failed', detail: err.message };
  }
}
