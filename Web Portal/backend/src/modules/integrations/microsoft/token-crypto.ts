import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Sealing for each person's Microsoft refresh token (1.23 Teams links): AES-256-GCM with the key from
 * MS_TOKEN_KEY, a fresh 12-byte IV for every value, and the auth tag checked when it is opened. The
 * stored value is base64url of: version byte | IV | tag | ciphertext. The person's user id is bound in
 * as additional data, so a sealed token copied onto another person's row can't be opened.
 */
export const TOKEN_FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const aadFor = (userId: string) => Buffer.from(`mico360/ms-token/v${TOKEN_FORMAT_VERSION}:${userId}`, 'utf8');

export interface TokenSealer {
  seal(token: string, userId: string): string;
  /** The token, or an error when the value was changed, sealed for someone else or with another key. */
  open(sealed: string, userId: string): string;
}

export function createTokenSealer(key: Buffer): TokenSealer {
  if (key.length !== 32) throw new Error('The Microsoft token key must be 32 bytes.');
  return {
    seal(token, userId) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aadFor(userId));
      const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([TOKEN_FORMAT_VERSION]), iv, cipher.getAuthTag(), ct]).toString('base64url');
    },
    open(sealed, userId) {
      const raw = Buffer.from(sealed, 'base64url');
      if (raw.length < 1 + IV_BYTES + TAG_BYTES) throw new Error('The sealed Microsoft token is malformed.');
      if (raw[0] !== TOKEN_FORMAT_VERSION) throw new Error('The sealed Microsoft token has an unknown format version.');
      const iv = raw.subarray(1, 1 + IV_BYTES);
      const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aadFor(userId));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(raw.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
    },
  };
}

/** MS_TOKEN_KEY: 32 random bytes written as base64 / base64url or as 64 hex characters; null otherwise. */
export function parseTokenKey(value: string | undefined | null): Buffer | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  if (!/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(v)) return null;
  const key = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return key.length === 32 ? key : null;
}
