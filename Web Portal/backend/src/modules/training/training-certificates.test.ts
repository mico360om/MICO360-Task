import { describe, expect, it } from 'vitest';
import { addMonths, certificateStatus, CODE_ALPHABET, newCertificateCode, normaliseCode, verifyLink } from './training-certificates';

describe('R10 certificate codes', () => {
  it('TC-XXXX-XXXX-XXXX from an alphabet without 0, O, 1 or I (60 random bits)', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
    const codes = new Set(Array.from({ length: 500 }, () => newCertificateCode()));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^TC-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });

  it('reads a typed code kindly (spaces, lower case, missing dashes); anything else is not a code', () => {
    expect(normaliseCode(' tc-abcd-efgh-jkmn ')).toBe('TC-ABCD-EFGH-JKMN');
    expect(normaliseCode('TCABCDEFGHJKMN')).toBe('TC-ABCD-EFGH-JKMN');
    expect(normaliseCode('TC-ABCD-EFGH-JKM0')).toBeNull();
    expect(normaliseCode('TC-ABCD-EFGH')).toBeNull();
    expect(normaliseCode('x'.repeat(100))).toBeNull();
    expect(normaliseCode("TC-ABCD-EFGH-JKMN' OR 1=1")).toBeNull();
  });
});

describe('status and expiry', () => {
  const now = new Date('2026-11-11T10:00:00.000Z');
  it('revoked, then expired, else valid', () => {
    expect(certificateStatus({ revokedAt: null, expiresAt: null }, now)).toBe('VALID');
    expect(certificateStatus({ revokedAt: null, expiresAt: new Date('2026-11-12T00:00:00Z') }, now)).toBe('VALID');
    expect(certificateStatus({ revokedAt: null, expiresAt: new Date('2026-11-11T09:59:59Z') }, now)).toBe('EXPIRED');
    expect(certificateStatus({ revokedAt: new Date('2026-01-01'), expiresAt: new Date('2025-01-01') }, now)).toBe('REVOKED');
  });

  it('expiry = issue + N months (end of a shorter month kept inside it)', () => {
    expect(addMonths(new Date('2026-01-31T08:00:00.000Z'), 1).toISOString()).toBe('2026-02-28T08:00:00.000Z');
    expect(addMonths(new Date('2026-11-11T08:00:00.000Z'), 12).toISOString()).toBe('2027-11-11T08:00:00.000Z');
  });

  it('the public verification link is on the website', () => {
    expect(verifyLink('https://task.mico360.com/', 'TC-ABCD-EFGH-JKMN')).toBe('https://task.mico360.com/verify/TC-ABCD-EFGH-JKMN');
    expect(verifyLink('http://localhost:5173', 'TC-ABCD-EFGH-JKMN')).toBe('http://localhost:5173/verify/TC-ABCD-EFGH-JKMN');
  });
});
