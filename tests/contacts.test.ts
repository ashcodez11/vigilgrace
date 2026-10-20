import { describe, expect, it } from 'vitest';

import {
  buildSeededContacts,
  hasVerifiedContact,
  isValidEmail,
  normalizePhone,
  sanitizeContactSeeds,
  validateName,
  validatePhone,
} from '@/core/contacts/contacts';
import type { EmergencyContact } from '@/core/types';

describe('phone validation', () => {
  it('normalizes 10-digit local numbers', () => {
    expect(normalizePhone('90000-00001')).toBe('9000000001');
    expect(normalizePhone('90000 00001')).toBe('9000000001');
    expect(validatePhone('9000000001').valid).toBe(true);
  });

  it('accepts international format', () => {
    const result = validatePhone('+91 90000 00001');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('+919000000001');
  });

  it('rejects too-short / too-long / garbage numbers', () => {
    expect(validatePhone('12345').valid).toBe(false);
    expect(validatePhone('1234567890123456').valid).toBe(false);
    expect(validatePhone('abcdefghij').valid).toBe(false);
    expect(validatePhone('').valid).toBe(false);
  });

  it('rejects 9-digit non-international numbers', () => {
    const result = validatePhone('123456789');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/international/i);
  });
});

describe('name and email validation', () => {
  it('validates names', () => {
    expect(validateName('Mom').valid).toBe(true);
    expect(validateName('  Mom  ').valid).toBe(true);
    expect(validateName('x').valid).toBe(false);
  });
  it('validates emails', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });
});

describe('seed contacts (initial emergency contacts)', () => {
  it('drops malformed entries and normalizes valid ones', () => {
    const seeds = sanitizeContactSeeds([
      { name: 'Mom', phone: '9000000001', relation: 'Family' },
      { name: 'X', phone: '9000000002' }, // invalid name
      { name: 'Bad phone', phone: 'abc' },
      'not-an-object',
      null,
      { name: 'Intl', phone: '+919000000002' },
    ]);
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toEqual({ name: 'Mom', phone: '9000000001', relation: 'Family' });
    expect(seeds[1]).toEqual({ name: 'Intl', phone: '+919000000002', relation: undefined });
  });

  it('builds unverified contact records with deterministic ids', () => {
    let n = 0;
    const contacts = buildSeededContacts(
      sanitizeContactSeeds([{ name: 'Mom', phone: '9000000001' }]),
      '2026-10-13T00:00:00.000Z',
      () => `id-${++n}`,
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.verified).toBe(false);
    expect(contacts[0]!.id).toBe('id-1');
    expect(contacts[0]!.createdAt).toBe('2026-10-13T00:00:00.000Z');
  });

  it('hasVerifiedContact only true when a contact is verified', () => {
    const contacts: EmergencyContact[] = [
      {
        id: '1',
        name: 'Mom',
        phone: '9000000001',
        verified: false,
        createdAt: '2026-10-13T00:00:00.000Z',
      },
    ];
    expect(hasVerifiedContact(contacts)).toBe(false);
    contacts[0]!.verified = true;
    expect(hasVerifiedContact(contacts)).toBe(true);
  });
});
