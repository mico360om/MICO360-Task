import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTokenSealer, parseTokenKey, TOKEN_FORMAT_VERSION } from './token-crypto';

const KEY = randomBytes(32);

describe('Microsoft token sealing (AES-256-GCM, version byte, bound to the person)', () => {
  const sealer = createTokenSealer(KEY);

  it('round-trips a refresh token for the same person', () => {
    const sealed = sealer.seal('0.AAAA-refresh-token-value', 'user-1');
    expect(sealed).not.toContain('refresh-token-value');
    expect(sealer.open(sealed, 'user-1')).toBe('0.AAAA-refresh-token-value');
  });

  it('starts with the format version byte and uses a fresh IV every time', () => {
    const a = Buffer.from(sealer.seal('same', 'user-1'), 'base64url');
    const b = Buffer.from(sealer.seal('same', 'user-1'), 'base64url');
    expect(a[0]).toBe(TOKEN_FORMAT_VERSION);
    expect(a.subarray(1, 13).equals(b.subarray(1, 13))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it('refuses a token sealed for someone else (it cannot be moved to another person)', () => {
    const sealed = sealer.seal('secret', 'user-1');
    expect(() => sealer.open(sealed, 'user-2')).toThrow();
  });

  it('refuses a changed value (the auth tag is checked), the wrong key and an unknown version', () => {
    const sealed = Buffer.from(sealer.seal('secret', 'user-1'), 'base64url');
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;
    expect(() => sealer.open(flipped.toString('base64url'), 'user-1')).toThrow();
    expect(() => createTokenSealer(randomBytes(32)).open(sealed.toString('base64url'), 'user-1')).toThrow();
    const future = Buffer.from(sealed);
    future[0] = 9;
    expect(() => sealer.open(future.toString('base64url'), 'user-1')).toThrow(/version/i);
    expect(() => sealer.open('short', 'user-1')).toThrow();
  });

  it('needs a 32-byte key', () => {
    expect(() => createTokenSealer(randomBytes(16))).toThrow();
  });
});

describe('MS_TOKEN_KEY', () => {
  it('takes 32 bytes written as base64 (with or without padding) or as 64 hex characters', () => {
    const raw = randomBytes(32);
    expect(parseTokenKey(raw.toString('base64'))?.equals(raw)).toBe(true);
    expect(parseTokenKey(raw.toString('base64url'))?.equals(raw)).toBe(true);
    expect(parseTokenKey(`  ${raw.toString('hex')}  `)?.equals(raw)).toBe(true);
  });

  it('refuses anything else (blank, too short, a password-like phrase)', () => {
    expect(parseTokenKey('')).toBeNull();
    expect(parseTokenKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(parseTokenKey('correct horse battery staple and more words')).toBeNull();
  });
});
