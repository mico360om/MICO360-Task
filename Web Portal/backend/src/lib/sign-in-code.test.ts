import { describe, it, expect } from 'vitest';
import { codeMatches, generateSignInCode, hashSignInCode, hashChallengeToken, maskEmail, newChallengeToken } from './sign-in-code';

describe('Sign-in codes (onboarding)', () => {
  it('a code is 6 digits, from a CSPRNG (no two hundred alike in a row)', () => {
    const codes = Array.from({ length: 200 }, () => generateSignInCode());
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(190);
  });

  it('the stored hash is keyed and tied to its challenge: the same code hashes differently per key and per challenge', () => {
    const a = hashSignInCode('123456', 'key-1', 'ch1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('123456');
    expect(hashSignInCode('123456', 'key-2', 'ch1')).not.toBe(a);
    expect(hashSignInCode('123456', 'key-1', 'ch2')).not.toBe(a);
    expect(hashSignInCode('123456', 'key-1', 'ch1')).toBe(a);
  });

  it('a code is compared with its hash (spaces typed around it or inside are ignored), wrong ones refused', () => {
    const hash = hashSignInCode('042917', 'k', 'c');
    expect(codeMatches('042917', hash, 'k', 'c')).toBe(true);
    expect(codeMatches(' 042 917 ', hash, 'k', 'c')).toBe(true);
    expect(codeMatches('042918', hash, 'k', 'c')).toBe(false);
    expect(codeMatches('42917', hash, 'k', 'c')).toBe(false);
    expect(codeMatches('', hash, 'k', 'c')).toBe(false);
    expect(codeMatches('abcdef', hash, 'k', 'c')).toBe(false);
    // A malformed stored hash never matches (and never throws).
    expect(codeMatches('042917', 'not-a-hash', 'k', 'c')).toBe(false);
  });

  it('a challenge token is 32 random bytes (base64url) and only its SHA-256 is kept', () => {
    const { token, tokenHash } = newChallengeToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(hashChallengeToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(newChallengeToken().token).not.toBe(token);
  });

  it('an address is shown masked: the first letter and the domain', () => {
    expect(maskEmail('ahmed@acme.com')).toBe('a•••@acme.com');
    expect(maskEmail('A@x.co')).toBe('A•••@x.co');
    expect(maskEmail('  sara.k@mico360.om ')).toBe('s•••@mico360.om');
    expect(maskEmail('no-at-sign')).toBe('n•••');
    expect(maskEmail('')).toBe('•••');
  });
});
