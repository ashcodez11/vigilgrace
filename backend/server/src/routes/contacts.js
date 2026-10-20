/**
 * Emergency-contact routes, including the phone-verification (OTP) flow.
 *
 * Contract (must match src/services/backend.ts in the app):
 *   GET    /contacts                     -> {contacts}
 *   POST   /contacts                     -> {contact}
 *   PATCH  /contacts/:id                 -> {contact}
 *   DELETE /contacts/:id                 -> {ok:true}
 *   POST   /contacts/:id/send-verify     -> {delivery, devCode?}
 *   POST   /contacts/:id/verify {code}   -> {contact}
 *
 * Safety invariants enforced here:
 *  - No code is generated unless a provider that can carry it is configured.
 *  - A provider response of "accepted" is reported as acceptance, never as
 *    delivery to the handset.
 *  - Codes are stored as salted digests, expire, are single-use and are
 *    attempt-limited; resends are rate-limited.
 *  - Codes, tokens and full phone numbers never reach the logs.
 */

import {
  codeMatches,
  hashCode,
  maskPhone,
  newOpaqueToken,
  newVerificationCode,
} from '../crypto/credentials.js';
import {
  DELIVERY_MODES,
  dispatchVerificationCode,
  resolveMode,
} from '../delivery/providers.js';
import { fail, json, readJson } from '../util/http.js';
import { authenticate } from './auth.js';

const NAME_MIN = 2;
const NAME_MAX = 60;

function normalizePhone(input) {
  const raw = String(input || '').trim();
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/** Same rule as the app: 10-digit local (India) or +E.164. */
function validatePhone(input) {
  const normalized = normalizePhone(input);
  const digits = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  if (digits.length < 7) return { valid: false, error: 'Phone number is too short (min 7 digits)' };
  if (digits.length > 15) {
    return { valid: false, error: 'Phone number is too long (max 15 digits, E.164)' };
  }
  if (/^0+$/.test(digits)) return { valid: false, error: 'Phone number is invalid' };
  if (!normalized.startsWith('+') && digits.length !== 10) {
    return {
      valid: false,
      error: 'Use a 10-digit local number or international format like +91XXXXXXXXXX',
    };
  }
  return { valid: true, normalized };
}

/** E.164 for delivery: local numbers are India (+91), anything else needs +. */
export function toE164(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.startsWith('+')) return normalized;
  if (normalized.length === 10) return `+91${normalized}`;
  return null;
}

export function registerContactRoutes(router, ctx) {
  const { store, env } = ctx;
  const now = () => (ctx.now ? ctx.now() : Date.now());
  const ttlMs = () => Number(env.VIGILGRACE_VERIFY_TTL_SECONDS ?? 600) * 1000;
  const cooldownMs = () => Number(env.VIGILGRACE_VERIFY_COOLDOWN_SECONDS ?? 60) * 1000;
  const maxAttempts = () => Number(env.VIGILGRACE_VERIFY_MAX_ATTEMPTS ?? 5);

  const requireUser = (req, res) => {
    const user = authenticate(store, req, now());
    if (!user) {
      fail(res, 401, 'Not signed in.');
      return null;
    }
    return user;
  };

  const findOwnedContact = (user, id) =>
    store.data.contacts.find((c) => c.id === id && c.userId === user.id) || null;

  const publicContact = (c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    ...(c.relation ? { relation: c.relation } : {}),
    verified: Boolean(c.verified),
    ...(c.verifyRequestedAt ? { verifyRequestedAt: c.verifyRequestedAt } : {}),
    createdAt: c.createdAt,
  });

  router.add('GET', '/contacts', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return undefined;
    const contacts = store.data.contacts
      .filter((c) => c.userId === user.id)
      .map(publicContact);
    return json(res, 200, { contacts });
  });

  router.add('POST', '/contacts', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return undefined;
    const body = await readJson(req);
    if (!body) return fail(res, 400, 'Malformed JSON body.');

    const name = String(body.name || '').trim();
    const phoneCheck = validatePhone(body.phone);
    const relation = body.relation ? String(body.relation).trim().slice(0, 40) : undefined;

    if (name.length < NAME_MIN) return fail(res, 400, 'Name is too short');
    if (name.length > NAME_MAX) return fail(res, 400, 'Name is too long');
    if (!phoneCheck.valid) return fail(res, 400, phoneCheck.error);

    const contact = {
      id: `c_${newOpaqueToken().slice(0, 16)}`,
      userId: user.id,
      name,
      phone: phoneCheck.normalized,
      relation,
      verified: false,
      createdAt: new Date(now()).toISOString(),
    };
    store.data.contacts.push(contact);
    store.save();
    return json(res, 201, { contact: publicContact(contact) });
  });

  router.add('PATCH', '/contacts/:id', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return undefined;
    const contact = findOwnedContact(user, req.params.id);
    if (!contact) return fail(res, 404, 'Contact not found.');
    const body = await readJson(req);
    if (!body) return fail(res, 400, 'Malformed JSON body.');

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < NAME_MIN) return fail(res, 400, 'Name is too short');
      if (name.length > NAME_MAX) return fail(res, 400, 'Name is too long');
      contact.name = name;
    }
    if (body.phone !== undefined) {
      const phoneCheck = validatePhone(body.phone);
      if (!phoneCheck.valid) return fail(res, 400, phoneCheck.error);
      if (phoneCheck.normalized !== contact.phone) {
        // A new number must be verified again: never inherit a verification.
        contact.verified = false;
        delete contact.verifyRequestedAt;
        store.data.verifications = store.data.verifications.filter(
          (v) => v.contactId !== contact.id,
        );
      }
      contact.phone = phoneCheck.normalized;
    }
    if (body.relation !== undefined) {
      contact.relation = String(body.relation).trim().slice(0, 40) || undefined;
    }
    store.save();
    return json(res, 200, { contact: publicContact(contact) });
  });

  router.add('DELETE', '/contacts/:id', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return undefined;
    const contact = findOwnedContact(user, req.params.id);
    if (!contact) return fail(res, 404, 'Contact not found.');
    store.data.contacts = store.data.contacts.filter((c) => c.id !== contact.id);
    store.data.verifications = store.data.verifications.filter((v) => v.contactId !== contact.id);
    store.save();
    return json(res, 200, { ok: true });
  });

  router.add('POST', '/contacts/:id/send-verify', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return undefined;
    const contact = findOwnedContact(user, req.params.id);
    if (!contact) return fail(res, 404, 'Contact not found.');

    // An already-verified contact needs no new code: the app only offers the
    // button for unverified contacts, so refusing here also closes the path that
    // could otherwise spend real SMS on repeated re-sends.
    if (contact.verified) {
      return fail(
        res,
        409,
        'This contact is already verified, so no new code was sent. Change the number if it needs verifying again.',
      );
    }

    const mode = resolveMode(env);
    if (mode === 'unknown' || !DELIVERY_MODES.includes(mode)) {
      // Refuse before generating anything: no code, no cooldown consumed.
      return json(res, 503, {
        error:
          'No SMS provider is configured on the server, so no verification code was sent. ' +
          'Configure VIGILGRACE_SMS_PROVIDER (mock | twilio | webhook) on the backend.',
        delivery: 'unknown',
      });
    }

    const startedAt = now();
    // The cooldown is anchored on the last *request* for this contact, which
    // survives the code being consumed or expiring. Anchoring it only on a live
    // code record let a caller verify a code and immediately request unlimited
    // more, since verification deletes the record it was measured against.
    const liveCode = store.data.verifications.find((v) => v.contactId === contact.id);
    const lastDispatchAt = Math.max(
      liveCode ? Date.parse(liveCode.createdAt) : 0,
      contact.verifyRequestedAt ? Date.parse(contact.verifyRequestedAt) : 0,
    );
    if (startedAt - lastDispatchAt < cooldownMs()) {
      return fail(res, 429, 'Verification requested too recently — try again later');
    }

    const to = toE164(contact.phone);
    if (!to) {
      return fail(res, 400, 'Contact phone number cannot be routed; use +E.164 format.');
    }

    const id = `v_${newOpaqueToken().slice(0, 16)}`;
    const code = newVerificationCode();
    const fresh = {
      id,
      contactId: contact.id,
      userId: user.id,
      digest: hashCode(code, id),
      createdAt: new Date(startedAt).toISOString(),
      expiresAt: new Date(startedAt + ttlMs()).toISOString(),
      attempts: 0,
      consumed: false,
    };

    let result;
    try {
      result = await dispatchVerificationCode(env, { to, code, contact: publicContact(contact) });
    } catch (err) {
      // Nothing was accepted -> wipe the record so no live code lingers.
      store.data.verifications = store.data.verifications.filter((v) => v.contactId !== contact.id);
      store.save();
      const status = err && err.status ? err.status : 502;
      console.warn(`[verify] dispatch failed for ${maskPhone(to)} via ${mode}: ${err.message}`);
      return fail(res, status, err.message);
    }

    store.data.verifications = store.data.verifications.filter((v) => v.contactId !== contact.id);
    store.data.verifications.push(fresh);
    contact.verifyRequestedAt = fresh.createdAt;
    store.save();

    // Logs carry no code and no full number.
    console.log(`[verify] code dispatched for ${maskPhone(to)} via ${mode}`);
    return json(res, 200, {
      delivery: result.delivery,
      ...(result.devCode ? { devCode: result.devCode } : {}),
    });
  });

  router.add('POST', '/contacts/:id/verify', async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return undefined;
    const contact = findOwnedContact(user, req.params.id);
    if (!contact) return fail(res, 404, 'Contact not found.');
    const body = await readJson(req);
    if (!body) return fail(res, 400, 'Malformed JSON body.');

    const code = String(body.code || '').trim();
    if (!/^\d{4,8}$/.test(code)) return fail(res, 400, 'Enter the code exactly as received.');

    const record = store.data.verifications.find((v) => v.contactId === contact.id);
    if (!record || record.consumed) {
      return fail(res, 400, 'No verification code was requested for this contact.');
    }
    if (Date.parse(record.expiresAt) <= now()) {
      store.data.verifications = store.data.verifications.filter((v) => v.id !== record.id);
      store.save();
      return fail(res, 410, 'The verification code has expired. Request a new code.');
    }
    if (record.attempts >= maxAttempts()) {
      return fail(res, 429, 'Too many failed attempts. Request a new code.');
    }

    if (!codeMatches(code, record.id, record.digest)) {
      record.attempts += 1;
      store.save();
      const left = Math.max(0, maxAttempts() - record.attempts);
      return fail(res, 400, `Incorrect verification code. ${left} attempt(s) left.`);
    }

    record.consumed = true;
    contact.verified = true;
    store.data.verifications = store.data.verifications.filter((v) => v.id !== record.id);
    store.save();
    console.log(`[verify] contact ${contact.id} verified`);
    return json(res, 200, { contact: publicContact(contact) });
  });
}
