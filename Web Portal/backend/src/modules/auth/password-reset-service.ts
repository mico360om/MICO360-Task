import { generateResetToken, hashResetToken } from '../../lib/reset-token';
import { isStrongPassword } from '../../lib/password-policy';
import { isExpired } from '../../lib/otp';
import { InvalidResetTokenError, WeakPasswordError } from './errors';

export interface ResetUser {
  id: string;
  email: string;
}

export interface ResetUserRepo {
  findActiveByIdentifier(identifier: string): Promise<ResetUser | null>;
  /** Set a new password hash AND clear the lockout (failed attempts + lockedUntil). */
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
  create(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findActiveByHash(tokenHash: string): Promise<ResetRecord | null>;
  consume(id: string): Promise<void>;
}

export interface ResetMailer {
  sendPasswordReset(email: string, link: string): Promise<void>;
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
}

export function createPasswordResetService(deps: PasswordResetServiceDeps) {
  /** Email a reset link if the account exists. Never reveals whether it does (T2.3). */
  async function requestReset(identifier: string): Promise<{ sent: true }> {
    const user = await deps.users.findActiveByIdentifier(identifier);
    if (user) {
      const { token, tokenHash } = generateResetToken();
      const expiresAt = new Date(Date.now() + deps.ttlSeconds * 1000);
      await deps.store.create({ userId: user.id, tokenHash, expiresAt });
      const link = `${deps.appUrl.replace(/\/$/, '')}/reset?token=${token}`;
      await deps.mailer.sendPasswordReset(user.email, link);
    }
    return { sent: true };
  }

  /** Consume a reset token, set the new password, and unlock the account. */
  async function resetPassword(token: string, newPassword: string): Promise<{ reset: true }> {
    if (!isStrongPassword(newPassword)) throw new WeakPasswordError();

    const record = await deps.store.findActiveByHash(hashResetToken(token));
    if (!record) throw new InvalidResetTokenError();
    if (isExpired(record.expiresAt)) throw new InvalidResetTokenError();

    const passwordHash = await deps.hashPassword(newPassword);
    await deps.users.setPasswordAndUnlock(record.userId, passwordHash);
    await deps.store.consume(record.id);
    // Invalidate every existing refresh token so a compromised session does not survive the reset.
    await deps.revokeSessions?.(record.userId);
    return { reset: true };
  }

  return { requestReset, resetPassword };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;
