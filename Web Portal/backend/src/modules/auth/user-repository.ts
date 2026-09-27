export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  status: UserStatus;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  roles?: string[];
  avatarUrl?: string | null;
  /** Embedded in access tokens as `ver`; bumping it revokes every outstanding access token. */
  tokenVersion?: number;
}

/** Persistence port the AuthService depends on (implemented by Prisma in prod, in-memory in tests). */
export interface AuthUserRepository {
  findByIdentifier(identifier: string): Promise<AuthUser | null>;
  findById(userId: string): Promise<AuthUser | null>;
  /**
   * Record a sign-in attempt as failed — before the password is checked, so parallel guesses
   * can't all slip past the lock. Sets the counter to `attempts` (and `lockedUntil` when given)
   * only while the stored counter still equals `expected`. Returns false when another attempt
   * changed it first; `void` (older fakes) counts as success.
   */
  applyFailedAttempt(userId: string, attempts: number, lockedUntil: Date | null, expected?: number): Promise<boolean | void>;
  /** Clear the failure counter and any lock (successful sign-in). */
  resetFailedAttempts(userId: string): Promise<void>;
}
