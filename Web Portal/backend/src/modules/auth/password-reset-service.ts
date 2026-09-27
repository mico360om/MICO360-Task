import { generateResetToken, hashResetToken } from '../../lib/reset-token';
import { isStrongPassword } from '../../lib/password-policy';
import { isExpired } from '../../lib/otp';
import { EmailUnavailableError, InvalidResetTokenError, WeakPasswordError } from './errors';

export interface ResetUser {
  id: string;
  email: string;
}

export interface ResetUserRepo {
  findActiveByIdentifier(identifier: string): Promise<ResetUser | null>;
  /**
   * Set a new password hash, clear the lockout (failed attempts + lockedUntil) and bump the
   * token version so every outstanding access token stops working.
   */
  setPasswordAndUnlock(userId: string, passwordHash: string): Promise<void>;
}

export interface ResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface PasswordResetStore {
  /** Store a new reset token and invalidate the user's earlier unused ones. */
  create(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findActiveByHash(tokenHash: string): Promise<ResetRecord | null>;
  /** Reset tokens issued to the user since `since` (request throttling). */
  countIssuedSince(userId: string, since: Date): Promise<number>;
  /** Atomically mark a token used; false when it was already used (a parallel reset won). */
  consume(id: string): Promise<boolean>;
  /** Invalidate every unused reset token for the user (after any password change). */
  consumeAllForUser(userId: string): Promise<void>;
}

export interface ResetMailer {
  sendPasswordReset(email: string, link: string): Promise<void>;
  /** False when no mail provider is configured at all. */
  isConfigured?(): boolean;
}

export interface PasswordResetServiceDeps {
  store: PasswordResetStore;
  users: ResetUserRepo;
  mailer: ResetMailer;
  ttlSeconds: number;
  appUrl: string;
  hashPassword: (plain: string) => Promise<string>;
  /** Revoke every live session for the user — a reset must log out whoever holds the old password. */
  revokeSessions?: (userId: string) => Promise<void>;
  /** Called after sessions are revoked so live connections can be closed too. */
  onSessionsRevoked?: (userId: string) => void | Promise<void>;
  /** Reset links that may be requested per account. Default 1 a minute, 5 an hour. */
  requestLimits?: { perMinute: number; perHour: number };
  /** Runs the token issue + email off the request path, so known and unknown accounts answer alike. */
  runInBackground?: (task: () => Promise<void>) => void;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
  now?: () => Date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function createPasswordResetService(deps: PasswordResetServiceDeps) {
  const limits = deps.requestLimits ?? { perMinute: 1, perHour: 5 };
  const now = deps.now ?? (() => new Date());
  const runInBackground =
    deps.runInBackground ??
    ((task: () => Promise<void>) => {
      void task().catch((err) => deps.logger?.warn('password reset email could not be sent', { err }));
    });
  const issuing = new Set<string>();

  async function issue(user: ResetUser): Promise<void> {
    const throttled = () => deps.logger?.warn('password reset request throttled', { userId: user.id });
    if (issuing.has(user.id)) {
      throttled();
      return;
    }
    issuing.add(user.id);
    try {
      const at = now().getTime();
      const [lastMinute, lastHour] = await Promise.all([
        deps.store.countIssuedSince(user.id, new Date(at - MINUTE)),
        deps.store.countIssuedSince(user.id, new Date(at - HOUR)),
      ]);
      if (lastMinute >= limits.perMinute || lastHour >= limits.perHour) {
        throttled();
        return;
      }
      const { token, tokenHash } = generateResetToken();
      await deps.store.create({ userId: user.id, tokenHash, expiresAt: new Date(at + deps.ttlSeconds * 1000) });
      const link = `${deps.appUrl.replace(/\/$/, '')}/reset?token=${token}`;
      await deps.mailer.sendPasswordReset(user.email, link);
    } finally {
      issuing.delete(user.id);
    }
  }

  /**
   * Email a reset link if the account exists (T2.3). Never reveals whether it does: the answer is
   * the same, and equally fast, for every identifier. If email isn't configured, every request gets 503.
   */
  async function requestReset(identifier: string): Promise<{ sent: true }> {
    if (deps.mailer.isConfigured && !deps.mailer.isConfigured()) throw new EmailUnavailableError();
    const user = await deps.users.findActiveByIdentifier(identifier);
    if (user) runInBackground(() => issue(user));
    return { sent: true };
  }

  /** Consume a reset token, set the new password, and unlock the account. */
  async function resetPassword(token: string, newPassword: string): Promise<{ reset: true }> {
    if (!isStrongPassword(newPassword)) throw new WeakPasswordError();

    const record = await deps.store.findActiveByHash(hashResetToken(token));
    if (!record) throw new InvalidResetTokenError();
    if (isExpired(record.expiresAt, now())) throw new InvalidResetTokenError();
    // Claim the token first: of two parallel resets with the same link, only one gets through.
    if (!(await deps.store.consume(record.id))) throw new InvalidResetTokenError();

    const passwordHash = await deps.hashPassword(newPassword);
    await deps.users.setPasswordAndUnlock(record.userId, passwordHash);
    // Older links from earlier emails must not be able to change the password again.
    await deps.store.consumeAllForUser(record.userId);
    // Invalidate every existing refresh token so a compromised session does not survive the reset.
    await deps.revokeSessions?.(record.userId);
    try {
      await deps.onSessionsRevoked?.(record.userId);
    } catch (err) {
      deps.logger?.warn('could not close live connections after a password reset', { err });
    }
    return { reset: true };
  }

  return { requestReset, resetPassword };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;
