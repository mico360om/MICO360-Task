import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from './tokens';

const secret = 'unit-test-secret-key';

describe('jwt tokens', () => {
  it('signs and verifies a token round-trip', () => {
    const token = signToken({ sub: 'user1', type: 'access' }, secret, 60);
    const payload = verifyToken(token, secret);
    expect(payload.sub).toBe('user1');
    expect(payload.type).toBe('access');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signToken({ sub: 'u' }, secret, 60);
    expect(() => verifyToken(token, 'a-different-secret')).toThrow();
  });

  it('rejects an expired token', () => {
    const token = signToken({ sub: 'u' }, secret, -1);
    expect(() => verifyToken(token, secret)).toThrow();
  });
});
