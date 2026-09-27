/**
 * Parsing for free-typed form fields, tolerant of what Arabic keyboards produce (ARB-04) and strict
 * about dates (MOB-06). Pure — used by Quick Add and the task editor, and unit-tested.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Arabic-Indic (٠١٢٣٤٥٦٧٨٩) and Eastern Arabic-Indic (۰۱۲۳۴۵۶۷۸۹) digits → ASCII 0-9. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Estimated hours. Accepts "2.5", "2,5", "٢٫٥", "۲٫۵", "٢،٥"; blank → null (no estimate).
 * Rejects anything that is not a non-negative number with an inline message instead of silently
 * turning it into "no estimate".
 */
export function parseHoursInput(input: string): Parsed<number | null> {
  let s = normalizeDigits(input).trim().replace(/\s+/g, '');
  if (!s) return { ok: true, value: null };
  if (/^[-−‒–]/.test(s)) return { ok: false, error: 'Hours can’t be negative.' };
  s = s
    .replace(/٬/g, '') // Arabic thousands separator
    .replace(/[٫,،]/g, '.'); // Arabic decimal separator, comma, Arabic comma → decimal point
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, error: 'Enter the hours as a number, e.g. 2.5' };
  const value = Number(s);
  if (!Number.isFinite(value)) return { ok: false, error: 'Enter the hours as a number, e.g. 2.5' };
  if (value < 0) return { ok: false, error: 'Hours can’t be negative.' };
  return { ok: true, value };
}

/**
 * A due date typed as YYYY-MM-DD (Arabic digits allowed). The value must round-trip through a real
 * calendar date, so "2026-02-31" is rejected instead of being saved as 3 March. Blank → null.
 */
export function parseDueDateInput(input: string): Parsed<string | null> {
  const s = normalizeDigits(input).trim();
  if (!s) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false, error: 'Use the format YYYY-MM-DD, e.g. 2026-09-30.' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return { ok: false, error: 'Enter a date between 1900 and 2200.' };
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.toISOString().slice(0, 10) !== s) return { ok: false, error: `${s} is not a real date.` };
  return { ok: true, value: s };
}
