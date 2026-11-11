import { randomBytes } from 'node:crypto';
import type { CertificateStatus } from './training-types';

/**
 * Certificates (owner answer 6, ruling R10), pure: unguessable codes, status, expiry and the public
 * verification link (the website's /verify/<code> page, which shows only course, name, dates and status).
 */

/** 32 letters and digits without 0, O, 1 and I (never misread): 5 bits each, 12 → 60 bits. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE = /^TC-([2-9A-HJ-NP-Z]{4})-([2-9A-HJ-NP-Z]{4})-([2-9A-HJ-NP-Z]{4})$/;

export function newCertificateCode(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b & 31]!);
  return `TC-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/** A typed or pasted code as stored, or null when it can't be one. */
export function normaliseCode(raw: string): string | null {
  const text = String(raw ?? '').trim().toUpperCase();
  if (text.length > 40) return null;
  const bare = text.replace(/[\s-]/g, '');
  if (!/^TC[2-9A-HJ-NP-Z]{12}$/.test(bare)) return null;
  const code = `TC-${bare.slice(2, 6)}-${bare.slice(6, 10)}-${bare.slice(10, 14)}`;
  return CODE.test(code) ? code : null;
}

export function certificateStatus(c: { revokedAt: Date | null; expiresAt: Date | null }, now: Date): CertificateStatus {
  if (c.revokedAt) return 'REVOKED';
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'VALID';
}

/** An instant N months later; the 31st becomes the month's last day when the month is shorter. */
export function addMonths(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** `<website>/verify/<code>`. */
export function verifyLink(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/+$/, '')}/verify/${encodeURIComponent(code)}`;
}
