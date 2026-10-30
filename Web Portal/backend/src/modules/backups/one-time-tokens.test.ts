import { describe, it, expect } from 'vitest';
import { createOneTimeTokens } from './one-time-tokens';

describe('signed one-time tokens (Google sign-in state, download links)', () => {
  let clock = new Date('2026-10-30T10:00:00Z');
  const tokens = createOneTimeTokens({ secret: 'jwt-access-secret-for-tests', purpose: 'drive-connect', now: () => clock });

  it('carries its data back once', () => {
    const t = tokens.issue({ userId: 'admin1' }, 10 * 60 * 1000);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(tokens.verify(t)).toEqual({ userId: 'admin1' });
    expect(tokens.verify(t)).toBeNull(); // used
  });

  it('refuses a changed token, an expired one, and one made for something else', () => {
    const t = tokens.issue({ userId: 'admin1' }, 60_000);
    const [body, sig] = t.split('.');
    const forged = `${Buffer.from(JSON.stringify({ userId: 'admin2', exp: Date.now() + 1e9, n: 'x' })).toString('base64url')}.${sig}`;
    expect(tokens.verify(forged)).toBeNull();
    expect(tokens.verify(`${body}.${sig!.slice(0, -2)}AA`)).toBeNull();
    expect(tokens.verify('garbage')).toBeNull();
    const late = tokens.issue({ userId: 'admin1' }, 60_000);
    clock = new Date(clock.getTime() + 61_000);
    expect(tokens.verify(late)).toBeNull();
    const other = createOneTimeTokens({ secret: 'jwt-access-secret-for-tests', purpose: 'backup-download', now: () => clock });
    expect(tokens.verify(other.issue({ userId: 'admin1' }, 60_000))).toBeNull();
  });
});
