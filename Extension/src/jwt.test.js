import { describe, it, expect } from 'vitest';
import { decodeJwtSub } from './jwt.js';

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
