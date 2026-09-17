import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/** Hash a plaintext password with a per-hash salt. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Constant-time verification of a plaintext password against a stored hash. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
