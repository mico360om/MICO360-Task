import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';

/** Generate a numeric one-time passcode of the given length using a CSPRNG. */
export function generateOtpCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

/** Hash an OTP for storage (never store the plaintext code). */
export async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

/** Verify a submitted OTP against its stored hash. */
export async function verifyOtp(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

/** True when the given expiry is at or before `now`. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
