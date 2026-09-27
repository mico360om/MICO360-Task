import { z } from 'zod';

/**
 * Request-schema building blocks matching the database limits: VARCHAR columns hold 191
 * characters and TEXT columns 65,535 bytes (about 32,000 Arabic characters), so bad input is
 * rejected with a 400 instead of reaching MySQL.
 */

export const VARCHAR_MAX = 191;
export const TEXT_MAX_BYTES = 65_535;

/** A trimmed, non-empty single-line value that fits a VARCHAR(191) column. */
export const requiredText = z.string().trim().min(1).max(VARCHAR_MAX);
/** A trimmed optional value that fits a VARCHAR(191) column. */
export const shortText = z.string().trim().max(VARCHAR_MAX);
/** An id reference (cuid) — bounded so an oversized value can't reach the database. */
export const idString = z.string().trim().min(1).max(VARCHAR_MAX);
/** Long text that fits a MySQL TEXT column (measured in UTF-8 bytes). */
export const longText = z
  .string()
  .refine((s) => Buffer.byteLength(s, 'utf8') <= TEXT_MAX_BYTES, { message: 'Text is too long.' });

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day in 'YYYY-MM-DD' form (rejects 2026-13-01 and 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** A 'YYYY-MM-DD' calendar day (board days, report ranges). */
export const calendarDay = z.string().refine(isCalendarDate, { message: 'Expected a real date (YYYY-MM-DD).' });

/**
 * A date sent as 'YYYY-MM-DD' (stored as UTC midnight of that day) or a full ISO timestamp.
 * The calendar part is checked strictly — JavaScript would silently roll 2026-02-30 into March.
 */
export const dateInput = z.union([z.string(), z.number(), z.date()]).transform((value, ctx): Date => {
  if (value instanceof Date || typeof value === 'number') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date.' });
      return z.NEVER;
    }
    return d;
  }
  const v = value.trim();
  if (isCalendarDate(v)) return new Date(`${v}T00:00:00.000Z`);
  const d = new Date(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || !isCalendarDate(v.slice(0, 10)) || Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a real date (YYYY-MM-DD) or an ISO timestamp.' });
    return z.NEVER;
  }
  return d;
});

/** A yes/no query flag: 'true'/'1' → true, 'false'/'0' → false (z.coerce.boolean reads 'false' as true). */
export const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

/** Non-negative hours with a sane ceiling. */
export const hours = z.number().finite().min(0).max(100_000);
