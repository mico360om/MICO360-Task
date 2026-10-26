import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The secrets of the client view: the token in a client's link and the token in their session
 * cookie. Each is 32 random bytes (256 bits) as base64url, and only its SHA-256 is stored — a fast
 * hash is right for high-entropy tokens and lets the row be found by it.
 */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** What newToken makes: 43 base64url characters. Anything else is refused before any lookup. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** An address as it is kept and compared: trimmed, lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Compares two texts in constant time (their SHA-256 digests, so lengths never show). */
export function sameText(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}

/**
 * Where the session cookie is sent: the client API only. The staff app's routes never receive it
 * (and they read a Bearer token, never a cookie), so a client session can't reach them.
 */
export const CLIENT_COOKIE_PATH = '/api/v1/client';

const COOKIE_PREFIX = 'mico_client_';

/** One cookie per shared project, so a browser can follow several projects shared with it. */
export function sessionCookieName(shareId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shareId)) throw new Error('Unexpected share id for a cookie name.');
  return `${COOKIE_PREFIX}${shareId}`;
}

export function sessionCookie(name: string, token: string, opts: { maxAgeSeconds: number; secure: boolean }): string {
  return `${name}=${token}; Path=${CLIENT_COOKIE_PATH}; Max-Age=${Math.floor(opts.maxAgeSeconds)}; HttpOnly; SameSite=Strict${opts.secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(name: string, opts: { secure: boolean }): string {
  return sessionCookie(name, '', { maxAgeSeconds: 0, secure: opts.secure });
}

/** One cookie's value from a Cookie header (null when it is missing or empty). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    return value || null;
  }
  return null;
}
