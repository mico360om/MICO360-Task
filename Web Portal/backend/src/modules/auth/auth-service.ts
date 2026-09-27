import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../lib/password';
import { isLocked, recordFailure } from '../../lib/lockout';
import type { AuthUser, AuthUserRepository } from './user-repository';
import { AccountInactiveError, AccountLockedError, InvalidCredentialsError } from './errors';

export interface AuthServiceDeps {
  users: AuthUserRepository;
  maxAttempts: number;
  /** Length of the first lock in minutes; each further failure doubles it (T2.11). Default 15. */
  lockMinutes?: number;
  now?: () => Date;
}

/** The public user shape returned by sign-in and refresh. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  roles: string[];
  avatarUrl: string | null;
}

/** An authenticated user plus the token version its access tokens must carry. */
export interface SessionUser extends AuthenticatedUser {
  tokenVersion: number;
}

export function toPublicUser(u: AuthenticatedUser): AuthenticatedUser {
  return { id: u.id, email: u.email, username: u.username, roles: u.roles, avatarUrl: u.avatarUrl };
}

function toSessionUser(user: AuthUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    roles: user.roles ?? [],
    avatarUrl: user.avatarUrl ?? null,
    tokenVersion: user.tokenVersion ?? 0,
  };
}

// A real bcrypt hash to compare against when the identifier is unknown, so unknown and known
// accounts take the same time to answer (no user enumeration by timing).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(18).toString('base64')));

export function createAuthService({ users, maxAttempts, lockMinutes = 15, now = () => new Date() }: AuthServiceDeps) {
  /**
   * Authenticate by email OR username + password (T2.2) with a time-limited lockout (T2.11).
   * Whether an account is inactive is only revealed after the correct password.
   */
  async function login(identifier: string, password: string): Promise<SessionUser> {
    const at = now();
    const user = await users.findByIdentifier(identifier);
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      throw new InvalidCredentialsError();
    }
    // While locked, no guess is evaluated — otherwise the lock would still answer "right/wrong".
    if (isLocked(user.lockedUntil, at)) throw new AccountLockedError(user.lockedUntil, at);

    // Count the attempt as failed up front (and lock pre-emptively on the last allowed one), so
    // a burst of parallel guesses can't all pass the check above; a correct password clears it.
    const failure = recordFailure({ attempts: user.failedLoginAttempts, max: maxAttempts, lockMinutes, now: at });
    const claimed = await users.applyFailedAttempt(user.id, failure.attempts, failure.lockedUntil, user.failedLoginAttempts);
    if (claimed === false) throw new InvalidCredentialsError(); // a concurrent attempt got there first

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      if (failure.lockedUntil) throw new AccountLockedError(failure.lockedUntil, at);
      throw new InvalidCredentialsError();
    }

    await users.resetFailedAttempts(user.id);
    if (user.status !== 'ACTIVE') throw new AccountInactiveError();
    return toSessionUser(user);
  }

  /**
   * Resolve the current user for a token refresh (A2.1). The caller has already verified the
   * refresh token; this re-checks the account still exists and is active. The password lockout
   * is deliberately not checked: it guards password guessing, and someone else's failed guesses
   * must not end the owner's existing session.
   */
  async function getUserForSession(userId: string): Promise<SessionUser> {
    const user = await users.findById(userId);
    if (!user) throw new InvalidCredentialsError();
    if (user.status !== 'ACTIVE') throw new AccountInactiveError();
    return toSessionUser(user);
  }

  return { login, getUserForSession };
}

export type AuthService = ReturnType<typeof createAuthService>;
