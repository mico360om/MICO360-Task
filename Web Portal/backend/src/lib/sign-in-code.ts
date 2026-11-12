import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Onboarding: the codes and tokens of a sign-in challenge (password → emailed code → session).
 *
 * A code is 6 digits from a CSPRNG. Only a keyed HMAC of it is stored, tied to its challenge (so a
 * stored hash is worthless without the server's key, and can't be replayed on another challenge), and a
 * typed code is compared with `timingSafeEqual` — the answer takes the same time however many digits
 * are right. The challenge's own token (what the website holds between the two steps) is 32 random
 * bytes; only its SHA-256 is stored. Neither a code nor a token is ever logged.
 */

export const SIGN_IN_CODE_DIGITS = 6;

/** A fresh 6-digit code (leading zeros kept). */
export function generateSignInCode(): string {
  let code = '';
  for (let i = 0; i < SIGN_IN_CODE_DIGITS; i++) code += randomInt(0, 10).toString();
  return code;
}

/** The stored form of a code: HMAC-SHA256(key, "<challengeId>:<code>"), hex. */
export function hashSignInCode(code: string, key: string, challengeId: string): string {
  return createHmac('sha256', key).update(`${challengeId}:${code}`).digest('hex');
}

/** Does the typed code match the stored hash? Spaces are ignored; anything but 6 digits never matches. */
export function codeMatches(typed: string, storedHash: string, key: string, challengeId: string): boolean {
  const code = String(typed ?? '').replace(/\s+/g, '');
  // Still hashed and compared when malformed, so a wrong-shaped guess takes as long as any other.
  const candidate = Buffer.from(hashSignInCode(/^\d{6}$/.test(code) ? code : 'x', key, challengeId), 'hex');
  const stored = /^[0-9a-f]{64}$/.test(storedHash) ? Buffer.from(storedHash, 'hex') : Buffer.alloc(candidate.length);
  const same = timingSafeEqual(candidate, stored);
  return same && /^\d{6}$/.test(code) && /^[0-9a-f]{64}$/.test(storedHash);
}

/** A challenge token (what the website holds between the password and the code) and its stored hash. */
export function newChallengeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashChallengeToken(token) };
}

export function hashChallengeToken(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** "a•••@acme.com": enough to recognise the address, not enough to learn it. */
export function maskEmail(email: string): string {
  const e = String(email ?? '').trim();
  const at = e.lastIndexOf('@');
  if (!e) return '•••';
  if (at <= 0) return `${e[0]}•••`;
  return `${e[0]}•••${e.slice(at)}`;
}
