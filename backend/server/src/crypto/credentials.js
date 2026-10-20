/**
 * Credential + verification-code hashing.
 *
 * Rules that matter for this app:
 *  - Passwords are never stored or logged in plaintext (scrypt + random salt).
 *  - Auth tokens are opaque random values; only a SHA-256 digest is stored.
 *  - Verification codes are never stored in plaintext either; the record keeps
 *    a salted digest and the code itself only ever travels to the provider (or
 *    back to the app in explicit mock mode, which is a documented dev contract).
 */

import {
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_KEYLEN = 64;

/** scrypt$<saltHex>$<hashHex> */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(String(password), salt, expected.length || SCRYPT_KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newOpaqueToken() {
  return randomBytes(32).toString('hex');
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/** 6-digit code with a CSPRNG (never Math.random). */
export function newVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Salted digest so identical codes on different records never collide. */
export function hashCode(code, recordId) {
  return sha256Hex(`${recordId}:${code}`);
}

export function codeMatches(code, recordId, storedDigest) {
  const digest = Buffer.from(hashCode(code, recordId), 'hex');
  const stored = Buffer.from(String(storedDigest || ''), 'hex');
  return digest.length === stored.length && timingSafeEqual(digest, stored);
}

/** Mask a phone number for logs: keep the last 4 digits only. */
export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `+${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
