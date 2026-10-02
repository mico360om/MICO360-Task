import { describe, it, expect } from 'vitest';
import { decodeJwtSub, decodeJwtRoles } from './jwt.js';

/** Build an unsigned JWT-shaped string with the given payload (base64url, no padding). */
function makeToken(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

describe('decodeJwtSub', () => {
  it('reads the sub (user id) claim', () => {
    expect(decodeJwtSub(makeToken({ sub: 'user-123', roles: ['EMPLOYEE'] }))).toBe('user-123');
  });
  it('returns null for a token without a sub', () => {
    expect(decodeJwtSub(makeToken({ roles: [] }))).toBeNull();
  });
  it('returns null for a malformed or empty token', () => {
    expect(decodeJwtSub('not-a-jwt')).toBeNull();
    expect(decodeJwtSub('')).toBeNull();
    expect(decodeJwtSub(null)).toBeNull();
    expect(decodeJwtSub(undefined)).toBeNull();
  });
});

describe('decodeJwtRoles', () => {
  it('reads the roles claim (to show admin-only screens; the server still enforces them)', () => {
    expect(decodeJwtRoles(makeToken({ sub: 'u1', roles: ['ADMIN', 'EMPLOYEE'] }))).toEqual(['ADMIN', 'EMPLOYEE']);
  });
  it('is empty for a token without roles, or a malformed one', () => {
    expect(decodeJwtRoles(makeToken({ sub: 'u1' }))).toEqual([]);
    expect(decodeJwtRoles(makeToken({ sub: 'u1', roles: 'ADMIN' }))).toEqual([]);
    expect(decodeJwtRoles('not-a-jwt')).toEqual([]);
    expect(decodeJwtRoles(null)).toEqual([]);
  });
});
