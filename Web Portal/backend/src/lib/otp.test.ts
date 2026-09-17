import { describe, it, expect } from 'vitest';
import { generateOtpCode, hashOtp, verifyOtp, isExpired } from './otp';

describe('otp', () => {
  it('generates a numeric code of the requested length', () => {
    expect(generateOtpCode(6)).toMatch(/^\d{6}$/);
    expect(generateOtpCode(4)).toMatch(/^\d{4}$/);
  });

  it('verifies a correct code against its hash', async () => {
    const code = generateOtpCode(6);
    const hash = await hashOtp(code);
    expect(await verifyOtp(code, hash)).toBe(true);
  });

  it('rejects an incorrect code', async () => {
    const hash = await hashOtp('123456');
    expect(await verifyOtp('000000', hash)).toBe(false);
  });

  it('reports expiry correctly', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});
