import { z } from 'zod';

/** True for an IANA time-zone name the runtime can format with (e.g. 'Asia/Muscat', 'UTC'). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A value that looks like "host:port/..." rather than "scheme:..." (so 'localhost:3000' gets https://). */
const HOST_PORT = /^[^:/?#\s]+:\d+(?:[/?#]|$)/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Normalize a meeting's online link: trim it, add https:// when no scheme was typed
 * ('meet.google.com/abc'), and allow only http(s) links. Returns null for a blank value and
 * throws for anything else (javascript:, data:, mailto:, malformed hosts).
 */
export function normalizeOnlineLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const candidate = HAS_SCHEME.test(value) && !HOST_PORT.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Enter a valid web link (https://…).');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || /\s/.test(candidate)) {
    throw new Error('Only http(s) web links are allowed.');
  }
  return candidate;
}

/** zod field for an IANA time zone (nullable/optional like the other meeting fields). */
export const timeZoneField = z
  .string()
  .trim()
  .refine(isValidTimeZone, { message: 'Unknown time zone — use an IANA name such as Asia/Muscat.' })
  .nullable()
  .optional();

/** zod field for the online link: normalized to an http(s) URL, blank → null. */
export const onlineLinkField = z
  .string()
  .max(2048)
  .transform((v, ctx) => {
    try {
      return normalizeOnlineLink(v);
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
      return z.NEVER;
    }
  })
  .nullable()
  .optional();
