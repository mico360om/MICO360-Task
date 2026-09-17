import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes a password to a non-plaintext string', async () => {
    const hash = await hashPassword('S3cret!pass');
    expect(hash).not.toBe('S3cret!pass');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('S3cret!pass');
    expect(await verifyPassword('S3cret!pass', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('S3cret!pass');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each time (per-hash salt)', async () => {
    const a = await hashPassword('samePass123');
    const b = await hashPassword('samePass123');
    expect(a).not.toBe(b);
  });
});
