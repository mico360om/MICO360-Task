import { describe, it, expect } from 'vitest';
import { generateResetToken, hashResetToken } from './reset-token';

describe('reset-token', () => {
  it('generates a URL-safe token with its matching SHA-256 hash', () => {
    const { token, tokenHash } = generateResetToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, safe in a query string
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(tokenHash).toBe(hashResetToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });

  it('produces a different token each call', () => {
    expect(generateResetToken().token).not.toBe(generateResetToken().token);
  });

  it('hashes deterministically so a token can be looked up', () => {
    expect(hashResetToken('abc')).toBe(hashResetToken('abc'));
    expect(hashResetToken('abc')).not.toBe(hashResetToken('abd'));
  });
});
