/**
 * Auth routes: register / login / me / keys.
 *
 * Contract (must match src/services/backend.ts in the app):
 *   POST /auth/register {email,password,name} -> {token, user}
 *   POST /auth/login    {email,password}       -> {token, user}
 *   GET  /auth/me                              -> {user}
 *   POST /auth/keys     {mlKemPublicKeyB64,mlDsaPublicKeyB64} -> {ok:true}
 */

import {
  hashPassword,
  newOpaqueToken,
  sha256Hex,
  verifyPassword,
} from '../crypto/credentials.js';
import { fail, json, readJson } from '../util/http.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    ...(user.mlKemPublicKeyB64 ? { mlKemPublicKeyB64: user.mlKemPublicKeyB64 } : {}),
    ...(user.mlDsaPublicKeyB64 ? { mlDsaPublicKeyB64: user.mlDsaPublicKeyB64 } : {}),
  };
}

/** Issue a session token; only its digest is stored. */
export function issueSession(store, userId, now = Date.now()) {
  const token = newOpaqueToken();
  store.data.sessions.push({
    tokenHash: sha256Hex(token),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });
  // keep the session table tidy: drop expired entries
  store.data.sessions = store.data.sessions.filter(
    (s) => Date.parse(s.expiresAt) > now,
  );
  store.save();
  return token;
}

/** Resolve the caller from `Authorization: Bearer <token>`; null when invalid. */
export function authenticate(store, req, now = Date.now()) {
  const header = String(req.headers.authorization || '');
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const digest = sha256Hex(token);
  const session = store.data.sessions.find((s) => s.tokenHash === digest);
  if (!session || Date.parse(session.expiresAt) <= now) return null;
  return store.data.users.find((u) => u.id === session.userId) || null;
}

export function registerAuthRoutes(router, ctx) {
  const { store } = ctx;
  const now = () => (ctx.now ? ctx.now() : Date.now());

  router.add('POST', '/auth/register', async (req, res) => {
    const body = await readJson(req);
    if (!body) return fail(res, 400, 'Malformed JSON body.');

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();

    if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid email address.');
    if (password.length < 8) {
      return fail(res, 400, 'Password must be at least 8 characters.');
    }
    if (name.length < 2) return fail(res, 400, 'Name is too short.');
    if (store.data.users.some((u) => u.email === email)) {
      return fail(res, 409, 'An account with that email already exists.');
    }

    const user = {
      id: `u_${newOpaqueToken().slice(0, 16)}`,
      email,
      name,
      passwordHash: hashPassword(password),
      createdAt: new Date(now()).toISOString(),
    };
    store.data.users.push(user);
    store.save();

    const token = issueSession(store, user.id, now());
    return json(res, 201, { token, user: publicUser(user) });
  });

  router.add('POST', '/auth/login', async (req, res) => {
    const body = await readJson(req);
    if (!body) return fail(res, 400, 'Malformed JSON body.');

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = store.data.users.find((u) => u.email === email);
    // Same message for unknown user and wrong password: no account enumeration.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return fail(res, 401, 'Invalid email or password.');
    }

    const token = issueSession(store, user.id, now());
    return json(res, 200, { token, user: publicUser(user) });
  });

  router.add('GET', '/auth/me', async (req, res) => {
    const user = authenticate(store, req, now());
    if (!user) return fail(res, 401, 'Not signed in.');
    return json(res, 200, { user: publicUser(user) });
  });

  router.add('POST', '/auth/keys', async (req, res) => {
    const user = authenticate(store, req, now());
    if (!user) return fail(res, 401, 'Not signed in.');
    const body = await readJson(req);
    if (!body) return fail(res, 400, 'Malformed JSON body.');

    const kem = body.mlKemPublicKeyB64;
    const dsa = body.mlDsaPublicKeyB64;
    if (typeof kem !== 'string' || typeof dsa !== 'string' || !kem || !dsa) {
      return fail(res, 400, 'Both mlKemPublicKeyB64 and mlDsaPublicKeyB64 are required.');
    }
    // Public keys only — never private key material.
    user.mlKemPublicKeyB64 = kem;
    user.mlDsaPublicKeyB64 = dsa;
    store.save();
    return json(res, 200, { ok: true });
  });
}
