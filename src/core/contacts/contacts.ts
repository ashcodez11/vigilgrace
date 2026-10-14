/**
 * Emergency contact validation + seeding (pure logic, unit-tested).
 */

import type { ContactSeed, EmergencyContact } from '../types';

export interface PhoneValidation {
  valid: boolean;
  /** E.164-style normalized number, e.g. +919066384152 */
  normalized: string;
  error?: string;
}

/** Strip formatting characters, keep leading + and digits. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export function validatePhone(raw: string): PhoneValidation {
  const normalized = normalizePhone(raw);
  const digits = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  if (digits.length < 7) {
    return { valid: false, normalized, error: 'Phone number is too short (min 7 digits)' };
  }
  if (digits.length > 15) {
    return { valid: false, normalized, error: 'Phone number is too long (max 15 digits, E.164)' };
  }
  if (/^0+$/.test(digits)) {
    return { valid: false, normalized, error: 'Phone number is invalid' };
  }
  if (normalized.startsWith('+') === false && digits.length !== 10) {
    // Local (non +) numbers are expected to be 10 digits (India); anything
    // else must be given in international form to avoid ambiguous routing.
    if (digits.length !== 10) {
      return {
        valid: false,
        normalized,
        error: 'Use a 10-digit local number or international format like +91XXXXXXXXXX',
      };
    }
  }
  return { valid: true, normalized };
}

export function validateName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 2) return { valid: false, error: 'Name is too short' };
  if (trimmed.length > 60) return { valid: false, error: 'Name is too long' };
  return { valid: true };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Accepts seeds from local config (private) or EXPO_PUBLIC_INITIAL_CONTACTS. */
export function sanitizeContactSeeds(input: unknown): ContactSeed[] {
  if (!Array.isArray(input)) return [];
  const out: ContactSeed[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name : '';
    const phone = typeof rec.phone === 'string' ? rec.phone : '';
    const relation = typeof rec.relation === 'string' ? rec.relation : undefined;
    const validation = validatePhone(phone);
    if (!validateName(name).valid || !validation.valid) continue;
    out.push({ name: name.trim(), phone: validation.normalized, relation });
  }
  return out;
}

/** Build initial contact records (unverified — verification is a user action). */
export function buildSeededContacts(
  seeds: ContactSeed[],
  nowIso: string,
  idFactory: () => string,
): EmergencyContact[] {
  return seeds.map((seed) => ({
    id: idFactory(),
    name: seed.name,
    phone: seed.phone,
    relation: seed.relation,
    verified: false,
    createdAt: nowIso,
  }));
}

/** True when at least one contact is verified (required before real SOS). */
export function hasVerifiedContact(contacts: EmergencyContact[]): boolean {
  return contacts.some((c) => c.verified);
}
