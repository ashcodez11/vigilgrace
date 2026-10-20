/**
 * Emergency alert routes: server post-quantum keys, sealed-envelope intake,
 * history and evidence metadata attachment.
 *
 * Contract (must match src/services/backend.ts in the app):
 *   GET  /crypto/server-keys            -> {kemPublicKeyB64, sigPublicKeyB64, algorithms}
 *   POST /alerts {envelope}             -> {accepted:true, duplicate, report}
 *   GET  /alerts?limit=                 -> {alerts:[summary]}
 *   GET  /alerts/:id                    -> {report}
 *   POST /alerts/:id/evidence {records} -> {ok:true, evidence}
 *
 * Safety invariants enforced here:
 *  - An alert is only recorded after its ML-DSA-65 signature verifies AND the
 *    signing key is the one registered for the calling user (no self-declared
 *    keys), and its payload digest matches the plaintext.
 *  - Delivery to a contact is reported as `sent` (provider accepted) or
 *    `simulated` (explicit mock mode) — never as handset delivery.
 *  - When nothing could be sent, the per-contact reason is returned so the app
 *    can tell the user the truth instead of a generic failure.
 *  - Contacts are never messaged unless they are verified, and alert history is
 *    scoped to its owner. Phone numbers never reach the logs.
 */

import {
  fromBase64Strict,
  isSealedEnvelope,
  openAlertEnvelope,
  verifyEnvelopeSignature,
} from '../crypto/envelope.js';
import { publicServerKeys, serverKemSecretKey } from '../crypto/server-keys.js';
import { alertMessage, dispatchAlertMessage, resolveMode } from '../delivery/providers.js';
import { fail, json, readJson } from '../util/http.js';
import { authenticate } from './auth.js';
import { toE164 } from './contacts.js';

const CONFIRMED_STATES = Object.freeze(['delivered', 'sent', 'simulated']);
const EVIDENCE_KINDS = Object.freeze(['audio', 'location-snapshot', 'note']);
const SHA256_B64_RE = /^[A-Za-z0-9+/]{43}=$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const MAX_EVIDENCE_RECORDS = 20;
const MAX_EVIDENCE_PER_ALERT = 50;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const NO_CONTACTS_MESSAGE =
  'No verified emergency contacts are configured, so no alert was sent. Add and verify a contact, ' +
  'then tap Retry — the same alert ID is reused, so nothing is duplicated.';

function requireUser(store, req, res, now) {
  const user = authenticate(store, req, now());
  if (!user) {
    fail(res, 401, 'Not signed in.');
    return null;
  }
  return user;
}

/**
 * Evidence is metadata ONLY. Raw audio/location bytes never belong here.
 *
 * `rejectContent` is true for the direct evidence endpoint, where a caller
 * sending content gets an explicit 400. Evidence already inside a SIGNED payload
 * is mapped to metadata instead (dropping the content field) — the envelope is
 * authentic, so losing the record would lose evidence, while the content itself
 * is still never stored.
 */
function sanitizeEvidenceRecord(input, { rejectContent = true } = {}) {
  if (!input || typeof input !== 'object') return null;
  if (
    rejectContent &&
    ('bytes' in input || 'contentForHash' in input || 'content' in input || 'audio' in input)
  ) {
    return null;
  }
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id || id.length > 128) return null;
  if (!EVIDENCE_KINDS.includes(input.kind)) return null;
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : '';
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  const sha256 = typeof input.sha256 === 'string' ? input.sha256.trim() : '';
  if (!SHA256_B64_RE.test(sha256) && !SHA256_HEX_RE.test(sha256)) return null;

  const record = {
    id,
    kind: input.kind,
    createdAt: new Date(createdAt).toISOString(),
    sha256,
    uploaded: Boolean(input.uploaded),
  };
  if (typeof input.localUri === 'string' && input.localUri.length <= 512) {
    record.localUri = input.localUri;
  }
  if (typeof input.contentType === 'string' && input.contentType.length <= 64) {
    record.contentType = input.contentType;
  }
  if (Number.isFinite(input.sizeBytes) && input.sizeBytes >= 0) {
    record.sizeBytes = Math.floor(input.sizeBytes);
  }
  return record;
}

function summaryOf(alert) {
  return {
    id: alert.id,
    status: alert.status,
    trigger: alert.trigger,
    createdAt: alert.createdAt,
    location: alert.location ? { latitude: alert.location.latitude, longitude: alert.location.longitude } : null,
    deliveryMode: alert.deliveryMode,
    payloadHashB64: alert.payloadHashB64,
    ...(alert.evidence && alert.evidence.length > 0 ? { evidence: alert.evidence } : {}),
  };
}

export function registerAlertRoutes(router, ctx) {
  const { store, env } = ctx;
  const now = () => (ctx.now ? ctx.now() : Date.now());
  /** Serialises concurrent retries of the same alert so nobody is messaged twice. */
  const inFlightRetries = new Map();

  /**
   * Message every verified contact that is not in `skipContactIds`.
   * One delivery path for both the first attempt and a retry of an alert that
   * was recorded as failed, so they cannot drift apart.
   */
  const deliverToVerifiedContacts = async (user, alert, skipContactIds = new Set()) => {
    const recipients = store.data.contacts.filter((c) => c.userId === user.id && c.verified);
    const results = [];
    for (const contact of recipients) {
      if (skipContactIds.has(contact.id)) continue;
      const to = toE164(contact.phone);
      if (!to) {
        results.push({
          contactId: contact.id,
          contactName: contact.name,
          channel: 'sms',
          state: 'failed',
          detail: 'This contact’s number cannot be routed; use +E.164 format.',
        });
        continue;
      }
      const text = alertMessage({
        userName: user.name,
        trigger: alert.trigger,
        location: alert.location,
      });
      const verdict = await dispatchAlertMessage(env, {
        to,
        text,
        meta: { alertId: alert.id, contactId: contact.id, trigger: alert.trigger },
      });
      results.push({
        contactId: contact.id,
        contactName: contact.name,
        channel: 'sms',
        state: verdict.state,
        detail: verdict.detail,
      });
    }
    return results;
  };

  const mergeResults = (previous, fresh) => {
    const byContact = new Map(previous.map((r) => [r.contactId, r]));
    for (const result of fresh) byContact.set(result.contactId, result);
    return Array.from(byContact.values());
  };

  // Public: the app seals alerts to this KEM key. Public halves only — the
  // secret halves are what decrypt, and they never leave the server.
  router.add('GET', '/crypto/server-keys', async (req, res) => json(res, 200, publicServerKeys(store, env)));

  router.add('POST', '/alerts', async (req, res) => {
    const user = requireUser(store, req, res, now);
    if (!user) return undefined;

    const body = await readJson(req);
    if (!body) return fail(res, 400, 'Malformed JSON body.');
    const envelope = body.envelope;
    if (!isSealedEnvelope(envelope)) {
      return fail(res, 400, 'Malformed alert envelope; nothing was sent.');
    }

    // Retries reuse the alertId, so an alert that is already recorded returns
    // its stored verdict instead of delivering twice.
    const existing = store.data.alerts.find((a) => a.id === envelope.alertId);
    if (existing) {
      if (existing.userId !== user.id) return fail(res, 403, 'That alert ID belongs to another account.');

      // An alert recorded as FAILED is still retryable — that is exactly what
      // the app's "Retry (same alert ID)" button promises. But a plain duplicate
      // response used to hand back the stored failure forever, so Retry could
      // never deliver. Retry now messages only the contacts that never got a
      // successful result, which keeps the no-duplicate-SOS guarantee for
      // everyone who was already reached. A delivered alert stays immutable.
      if (existing.report?.status === 'failed') {
        let pending = inFlightRetries.get(existing.id);
        if (!pending) {
          pending = (async () => {
            const alreadyReached = new Set(
              (existing.report.results || [])
                .filter((r) => CONFIRMED_STATES.includes(r.state))
                .map((r) => r.contactId),
            );
            const fresh = await deliverToVerifiedContacts(user, existing, alreadyReached);
            if (fresh.length === 0) return;
            const results = mergeResults(existing.report.results || [], fresh);
            const confirmed = results.some((r) => CONFIRMED_STATES.includes(r.state));
            const mode = resolveMode(env);
            existing.report = {
              alertId: existing.id,
              status: confirmed ? 'delivered' : 'failed',
              deliveryMode: mode,
              results,
              updatedAt: new Date(now()).toISOString(),
            };
            existing.status = existing.report.status;
            existing.deliveryMode = mode;
            store.save();
            console.log(
              `[alert] ${existing.id} retried mode=${mode} confirmed=${confirmed} contacts=${fresh.length}`,
            );
          })().finally(() => inFlightRetries.delete(existing.id));
          inFlightRetries.set(existing.id, pending);
        }
        await pending;
        return json(res, 200, {
          accepted: true,
          duplicate: true,
          retried: true,
          report: existing.report,
        });
      }

      return json(res, 200, { accepted: true, duplicate: true, report: existing.report });
    }

    if (!user.mlDsaPublicKeyB64) {
      return fail(
        res,
        409,
        'This account has no registered signing key, so the alert could not be verified and nothing was sent. ' +
          'Sign out and sign in again to register this device’s key, then retry.',
      );
    }

    let signerPub;
    try {
      signerPub = fromBase64Strict(envelope.signerPubB64, 'signerPubB64');
    } catch {
      return fail(res, 400, 'The alert envelope’s signing key is malformed; nothing was sent.');
    }
    const registered = Buffer.from(user.mlDsaPublicKeyB64, 'base64');
    if (registered.length !== signerPub.length || !registered.equals(Buffer.from(signerPub))) {
      return fail(
        res,
        403,
        'The alert was signed with a key that is not registered for your account; nothing was sent.',
      );
    }
    if (!verifyEnvelopeSignature(envelope)) {
      return fail(res, 400, 'The alert signature is not valid; nothing was sent.');
    }

    let opened;
    try {
      opened = openAlertEnvelope(envelope, serverKemSecretKey(store, env));
    } catch (err) {
      // Reason codes only — never plaintext, keys or ciphertext in the response.
      return fail(res, 400, `The alert envelope could not be opened (${err.code}); nothing was sent.`);
    }

    const payload = opened.payload;
    if (payload.userId !== user.id) {
      return fail(res, 403, 'The alert payload belongs to a different account; nothing was sent.');
    }

    const recipients = store.data.contacts.filter((c) => c.userId === user.id && c.verified);
    if (recipients.length === 0) {
      // Not retryable by itself, and an emergency is the wrong moment to spend
      // 30 s retrying: refuse immediately with the reason the user can act on.
      // Nothing is recorded, so a Retry after adding a contact still delivers.
      return fail(res, 409, NO_CONTACTS_MESSAGE);
    }

    const mode = resolveMode(env);
    const results = await deliverToVerifiedContacts(user, {
      id: envelope.alertId,
      trigger: payload.trigger,
      location: payload.location,
    });

    const confirmed = results.some((r) => CONFIRMED_STATES.includes(r.state));
    const report = {
      alertId: envelope.alertId,
      status: confirmed ? 'delivered' : 'failed',
      deliveryMode: mode,
      results,
      updatedAt: new Date(now()).toISOString(),
    };

    const evidence = Array.isArray(payload.evidence)
      ? payload.evidence
          .slice(0, MAX_EVIDENCE_PER_ALERT)
          .map((record) => sanitizeEvidenceRecord(record, { rejectContent: false }))
          .filter(Boolean)
      : [];

    store.data.alerts.push({
      id: envelope.alertId,
      userId: user.id,
      status: report.status,
      trigger: payload.trigger,
      createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date(now()).toISOString(),
      location: payload.location
        ? { latitude: payload.location.latitude, longitude: payload.location.longitude }
        : null,
      deliveryMode: mode,
      payloadHashB64: opened.payloadHashB64,
      evidence,
      // Kept so the recorded history can be re-verified against the signature.
      envelope,
      receivedAt: new Date(now()).toISOString(),
      report,
    });
    store.save();

    console.log(
      `[alert] ${envelope.alertId} trigger=${payload.trigger} mode=${mode} contacts=${recipients.length} confirmed=${confirmed}`,
    );
    return json(res, 200, { accepted: true, duplicate: false, report });
  });

  router.add('GET', '/alerts', async (req, res) => {
    const user = requireUser(store, req, res, now);
    if (!user) return undefined;

    let limit = DEFAULT_LIMIT;
    try {
      const raw = new URL(req.url, 'http://localhost').searchParams.get('limit');
      const parsed = Number.parseInt(raw ?? '', 10);
      if (Number.isFinite(parsed)) limit = Math.min(Math.max(parsed, 1), MAX_LIMIT);
    } catch {
      // keep the default
    }

    const alerts = store.data.alerts
      .filter((a) => a.userId === user.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit)
      .map(summaryOf);
    return json(res, 200, { alerts });
  });

  router.add('GET', '/alerts/:id', async (req, res) => {
    const user = requireUser(store, req, res, now);
    if (!user) return undefined;
    const alert = store.data.alerts.find((a) => a.id === req.params.id && a.userId === user.id);
    if (!alert) return fail(res, 404, 'Alert not found.');
    return json(res, 200, { report: alert.report });
  });

  router.add('POST', '/alerts/:id/evidence', async (req, res) => {
    const user = requireUser(store, req, res, now);
    if (!user) return undefined;
    const alert = store.data.alerts.find((a) => a.id === req.params.id && a.userId === user.id);
    if (!alert) return fail(res, 404, 'Alert not found.');

    const body = await readJson(req);
    if (!body) return fail(res, 400, 'Malformed JSON body.');
    const records = body.records;
    if (!Array.isArray(records) || records.length === 0) {
      return fail(res, 400, 'Send at least one evidence record.');
    }
    if (records.length > MAX_EVIDENCE_RECORDS) {
      return fail(res, 400, `At most ${MAX_EVIDENCE_RECORDS} evidence records per request.`);
    }

    const clean = [];
    for (const record of records) {
      const sanitized = sanitizeEvidenceRecord(record);
      if (!sanitized) {
        return fail(
          res,
          400,
          'Evidence must be metadata only: id, kind (audio | location-snapshot | note), createdAt and a ' +
            'SHA-256 digest. Raw content is not accepted.',
        );
      }
      clean.push(sanitized);
    }

    const byId = new Map((alert.evidence ?? []).map((r) => [r.id, r]));
    for (const record of clean) byId.set(record.id, record);
    alert.evidence = Array.from(byId.values()).slice(0, MAX_EVIDENCE_PER_ALERT);
    store.save();

    return json(res, 200, { ok: true, evidence: alert.evidence });
  });
}
