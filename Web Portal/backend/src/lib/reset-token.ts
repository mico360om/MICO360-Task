import { randomBytes, createHash } from 'node:crypto';

/** A high-entropy password-reset token plus its lookup hash. */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

/**
 * Deterministic SHA-256 of a reset token. The token is high-entropy, so a fast
 * hash is appropriate (and lets us look the record up by hash, unlike bcrypt).
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
