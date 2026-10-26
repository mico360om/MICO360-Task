import { describe, it, expect } from 'vitest';
import {
  CLIENT_COOKIE_PATH,
  clearedSessionCookie,
  hashToken,
  isWellFormedToken,
  newToken,
  normalizeEmail,
  readCookie,
  sameText,
  sessionCookie,
  sessionCookieName,
} from './client-tokens';

describe('client view tokens (links and sessions)', () => {
  it('are long and random: 32 bytes as base64url, never the same twice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { token, hash } = newToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(hash).toBe(hashToken(token));
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });

  it('are stored only as their SHA-256 (64 hex characters), never as they are', () => {
    const { token, hash } = newToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('a malformed token is refused before anything is looked up', () => {
    expect(isWellFormedToken(newToken().token)).toBe(true);
    for (const bad of ['', 'abc', 'x'.repeat(42), 'x'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}/`, null, undefined, 42]) {
      expect(isWellFormedToken(bad as unknown)).toBe(false);
    }
  });
});

describe('comparing secrets and addresses', () => {
  it('compares in constant time (equal length digests), and only equal texts match', () => {
    expect(sameText('ada@example.com', 'ada@example.com')).toBe(true);
    expect(sameText('ada@example.com', 'ada@example.co')).toBe(false);
    expect(sameText('', '')).toBe(true);
    expect(sameText('a', '')).toBe(false);
  });

  it('an address is compared trimmed and in lower case', () => {
    expect(normalizeEmail('  Ada.Lovelace@Example.COM ')).toBe('ada.lovelace@example.com');
  });
});

describe('the client session cookie', () => {
  it('is httpOnly, SameSite=Strict, Secure and scoped to the client API only (never sent to staff routes)', () => {
    const c = sessionCookie('mico_client_abc', 'tok', { maxAgeSeconds: 30 * 86400, secure: true });
    expect(c).toBe(`mico_client_abc=tok; Path=${CLIENT_COOKIE_PATH}; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure`);
    expect(CLIENT_COOKIE_PATH).toBe('/api/v1/client');
  });

  it('leaves out Secure only when asked (plain http on a development machine)', () => {
    expect(sessionCookie('n', 't', { maxAgeSeconds: 60, secure: false })).not.toContain('Secure');
  });

  it('is cleared with an empty value that expires at once', () => {
    expect(clearedSessionCookie('mico_client_abc', { secure: true })).toBe(`mico_client_abc=; Path=${CLIENT_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict; Secure`);
  });

  it('is named per shared project, so one browser can follow several projects', () => {
    expect(sessionCookieName('ckshare123')).toBe('mico_client_ckshare123');
    expect(() => sessionCookieName('bad id;')).toThrow();
  });

  it('is read from a Cookie header among others; a missing or empty one reads as null', () => {
    const header = 'theme=dark; mico_client_a=tok-a;mico_client_b=tok-b ; other=1';
    expect(readCookie(header, 'mico_client_a')).toBe('tok-a');
    expect(readCookie(header, 'mico_client_b')).toBe('tok-b');
    expect(readCookie(header, 'mico_client_c')).toBeNull();
    expect(readCookie('mico_client_a=', 'mico_client_a')).toBeNull();
    expect(readCookie(undefined, 'mico_client_a')).toBeNull();
    // A name that only ends the same way is not the cookie.
    expect(readCookie('xmico_client_a=evil', 'mico_client_a')).toBeNull();
  });
});
