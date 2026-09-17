import { verifyPassword } from '../../lib/password';
import { recordFailure } from '../../lib/lockout';
import type { AuthUserRepository } from './user-repository';
import { AccountInactiveError, AccountLockedError, InvalidCredentialsError } from './errors';

export interface AuthServiceDeps {
  users: AuthUserRepository;
  maxAttempts: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  roles: string[];
  avatarUrl: string | null;
}

export function createAuthService({ users, maxAttempts }: AuthServiceDeps) {
  /**
   * Authenticate by email OR username + password (T2.2), enforcing account
   * status (T2.4) and the 5-strike lockout (T2.11).
   */
  async function login(identifier: string, password: string): Promise<AuthenticatedUser> {
    const user = await users.findByIdentifier(identifier);
    if (!user) throw new InvalidCredentialsError();
    if (user.status !== 'ACTIVE') throw new AccountInactiveError();
    if (user.lockedUntil) throw new AccountLockedError();

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const { attempts, lock } = recordFailure({ attempts: user.failedLoginAttempts, max: maxAttempts });
      await users.applyFailedAttempt(user.id, attempts, lock);
      if (lock) throw new AccountLockedError();
      throw new InvalidCredentialsError();
    }

    if (user.failedLoginAttempts > 0) {
      await users.resetFailedAttempts(user.id);
    }
    return { id: user.id, email: user.email, username: user.username, roles: user.roles ?? [], avatarUrl: user.avatarUrl ?? null };
  }

  /**
   * Resolve the current user for a token refresh (A2.1). The caller has already
   * verified the refresh token; this re-checks the account is still valid so a
   * deactivated / locked user cannot mint fresh access tokens.
   */
  async function getUserForSession(userId: string): Promise<AuthenticatedUser> {
    const user = await users.findById(userId);
    if (!user) throw new InvalidCredentialsError();
    if (user.status !== 'ACTIVE') throw new AccountInactiveError();
    if (user.lockedUntil) throw new AccountLockedError();
    return { id: user.id, email: user.email, username: user.username, roles: user.roles ?? [], avatarUrl: user.avatarUrl ?? null };
  }

  return { login, getUserForSession };
}

export type AuthService = ReturnType<typeof createAuthService>;
