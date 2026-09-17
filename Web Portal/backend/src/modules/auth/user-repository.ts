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
}

/** Persistence port the AuthService depends on (implemented by Prisma in prod, in-memory in tests). */
export interface AuthUserRepository {
  findByIdentifier(identifier: string): Promise<AuthUser | null>;
  findById(userId: string): Promise<AuthUser | null>;
  applyFailedAttempt(userId: string, attempts: number, lock: boolean): Promise<void>;
  resetFailedAttempts(userId: string): Promise<void>;
}
