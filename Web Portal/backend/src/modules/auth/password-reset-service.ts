import { generateResetToken, hashResetToken } from '../../lib/reset-token';
import { isStrongPassword } from '../../lib/password-policy';
import { isExpired } from '../../lib/otp';
import { EmailUnavailableError, InvalidResetTokenError, WeakPasswordError } from './errors';
import type { PasswordResetEmailOptions, TemplateOptions } from '../email/email-templates';

export interface ResetUser {
  id: string;
  email: string;
}

export interface ResetUserRepo {
  findActiveByIdentifier(identifier: string): Promise<ResetUser | null>;
  /** Onboarding: a non-deleted person by id, with their status (an administrator's "Send password reset"). */
  findById?(userId: string): Promise<{ id: string; email: string; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; invitationCancelled?: boolean; mustChangePassword?: boolean } | null>;
  /** Onboarding: has the account become theirs (signed in, or set a password with a link)? */
  isActivated?(userId: string): Promise<boolean>;
  /**
   * Set a new password hash, clear the lockout (failed attempts + lockedUntil) and bump the
   * token version so every outstanding access token stops working.
   */
  setPasswordAndUnlock(userId: string, passwordHash: string): Promise<void>;
  /** True while the account is ACTIVE and not deleted (a locked account is still active). */
  isActive(userId: string): Promise<boolean>;
}

export interface ResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  /** A reset link or a welcome email's (invitation) link; absent: a reset link (older stores). */
  purpose?: 'PASSWORD_RESET' | 'WELCOME';
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
  /** Onboarding: any reset or invitation link by its hash, used, ended or not (the link page asks). */
  findAnyByHash?(tokenHash: string): Promise<ResetRecord | null>;
}

export interface ResetMailer {
  sendPasswordReset(email: string, link: string, opts?: PasswordResetEmailOptions): Promise<unknown>;
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
  /** Forget the user's phones (push device tokens) after a reset, so old devices stop getting notifications. */
  forgetDevices?: (userId: string) => Promise<void>;
  /** Reset links that may be requested per account. Default 1 a minute, 5 an hour. */
  requestLimits?: { perMinute: number; perHour: number };
  /** Runs the token issue + email off the request path, so known and unknown accounts answer alike. */
  runInBackground?: (task: () => Promise<void>) => void;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
  now?: () => Date;
  /** Companies: the person's company brand on the email (their primary company's name, logo and sender name). */
  emailOptions?: (userId: string) => Promise<TemplateOptions | undefined>;
  /** Onboarding: a link was used — it confirms the email address; an invitation makes the account theirs. */
  onLinkUsed?: (userId: string, purpose: 'PASSWORD_RESET' | 'WELCOME') => Promise<void>;
  /** Onboarding: the company the person belongs to, named on "This invitation has expired — ask … to send a new one". */
  companyName?: (userId: string) => Promise<string | null>;
}

/** What a set-password link is, for its page (asked before a password is typed). */
export interface LinkStatus {
  kind: 'welcome' | 'reset' | null;
  /** live: it works; expired: too old, replaced or the account stopped; used: the account is set up already. */
  state: 'live' | 'expired' | 'used' | 'unknown';
  company: string | null;
}

/** Why an administrator's "Send password reset" didn't go. */
export type AdminResetRefusal = 'NOT_FOUND' | 'ACCOUNT_INACTIVE' | 'ACCOUNT_SUSPENDED' | 'NO_EMAIL' | 'INVITATION_CANCELLED' | 'TEMPORARY_PASSWORD' | 'TOO_SOON' | 'DELIVERY_FAILED';

export const ADMIN_RESET_REFUSAL_WHY: Record<AdminResetRefusal, string> = {
  NOT_FOUND: 'the account no longer exists',
  ACCOUNT_INACTIVE: 'the account is inactive (reactivate it first)',
  ACCOUNT_SUSPENDED: 'the account is suspended (reactivate it first)',
  NO_EMAIL: 'the account has no email address',
  INVITATION_CANCELLED: 'the invitation was cancelled (send a new invitation or set a temporary password)',
  TEMPORARY_PASSWORD: 'they have a temporary password to change at their first sign-in (send an invitation instead; it replaces the temporary password)',
  TOO_SOON: 'a reset link was sent to them less than a minute ago',
  DELIVERY_FAILED: 'the email couldn’t be delivered (try again later)',
};

export interface AdminResetOutcome {
  userId: string;
  email: string | null;
  sent: boolean;
  sentAt?: string;
  reason?: AdminResetRefusal;
  why?: string;
}

/** An administrator's reset link works this long (whatever PASSWORD_RESET_TTL_SECONDS says). */
export const ADMIN_RESET_TTL_SECONDS = 3600;

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
      // Off the request path (runInBackground): reading the brand takes no time anyone can measure.
      const brand = await deps.emailOptions?.(user.id).catch(() => undefined);
      if (brand) await deps.mailer.sendPasswordReset(user.email, link, brand);
      else await deps.mailer.sendPasswordReset(user.email, link);
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
    // An account made inactive, suspended or deleted since the link went: the same answer as a dead
    // link, so it reveals nothing. A locked account is still active, and setting a password unlocks it.
    if (!(await deps.users.isActive(record.userId))) throw new InvalidResetTokenError();
    // Claim the token first: of two parallel resets with the same link, only one gets through.
    if (!(await deps.store.consume(record.id))) throw new InvalidResetTokenError();

    const passwordHash = await deps.hashPassword(newPassword);
    await deps.users.setPasswordAndUnlock(record.userId, passwordHash);
    // Onboarding: the link reached the mailbox, so the address is theirs (an invitation also makes the
    // account theirs). Bookkeeping: a failure is logged and never undoes the new password.
    try {
      await deps.onLinkUsed?.(record.userId, record.purpose ?? 'PASSWORD_RESET');
    } catch (err) {
      deps.logger?.warn('could not record a used set-password link', { userId: record.userId, error: err instanceof Error ? err.message : String(err) });
    }
    // Older links from earlier emails must not be able to change the password again.
    await deps.store.consumeAllForUser(record.userId);
    // Invalidate every existing refresh token so a compromised session does not survive the reset.
    await deps.revokeSessions?.(record.userId);
    try {
      await deps.forgetDevices?.(record.userId);
    } catch (err) {
      deps.logger?.warn('could not forget the phones after a password reset', { err });
    }
    try {
      await deps.onSessionsRevoked?.(record.userId);
    } catch (err) {
      deps.logger?.warn('could not close live connections after a password reset', { err });
    }
    return { reset: true };
  }

  /** What a link is: its page says "expired — ask <company> for a new one" before a password is typed. */
  async function linkStatus(token: string): Promise<LinkStatus> {
    const record = await deps.store.findAnyByHash?.(hashResetToken(token));
    if (!record) return { kind: null, state: 'unknown', company: null };
    const kind = record.purpose === 'WELCOME' ? 'welcome' : 'reset';
    const company = (await deps.companyName?.(record.userId).catch(() => null)) ?? null;
    const active = await deps.users.isActive(record.userId);
    if (active && record.consumedAt === null && !isExpired(record.expiresAt, now())) return { kind, state: 'live', company };
    // An invitation whose account is set up already: "used" (sign in). Anything else: expired.
    const used = kind === 'welcome' && record.consumedAt !== null && active && ((await deps.users.isActivated?.(record.userId)) ?? false);
    return { kind, state: used ? 'used' : 'expired', company };
  }

  /**
   * An administrator's "Send password reset": a reset link valid 1 hour to the account's address (earlier
   * unused reset links stop). The person's sessions stay until they set the new password (then all end).
   * Refusals are answers, never errors; the link is never in the answer or a log.
   */
  async function sendForAdministrator(userId: string): Promise<AdminResetOutcome> {
    const refuse = (reason: AdminResetRefusal, email: string | null = null): AdminResetOutcome => ({ userId, email, sent: false, reason, why: ADMIN_RESET_REFUSAL_WHY[reason] });
    const user = await deps.users.findById?.(userId);
    if (!user) return refuse('NOT_FOUND');
    if (user.status === 'INACTIVE') return refuse('ACCOUNT_INACTIVE', user.email);
    if (user.status === 'SUSPENDED') return refuse('ACCOUNT_SUSPENDED', user.email);
    // 1.23.6: one way in — never a reset link beside a cancelled invitation or a temporary password.
    if (user.invitationCancelled) return refuse('INVITATION_CANCELLED', user.email);
    if (user.mustChangePassword) return refuse('TEMPORARY_PASSWORD', user.email);
    const email = user.email.trim();
    if (!email || !email.includes('@')) return refuse('NO_EMAIL', user.email);
    if (issuing.has(userId)) return refuse('TOO_SOON', email);
    issuing.add(userId);
    try {
      const at = now();
      if ((await deps.store.countIssuedSince(userId, new Date(at.getTime() - MINUTE))) > 0) return refuse('TOO_SOON', email);
      const { token, tokenHash } = generateResetToken();
      await deps.store.create({ userId, tokenHash, expiresAt: new Date(at.getTime() + ADMIN_RESET_TTL_SECONDS * 1000) });
      const link = `${deps.appUrl.replace(/\/+$/, '')}/reset?token=${token}`;
      const brand = await deps.emailOptions?.(userId).catch(() => undefined);
      try {
        await deps.mailer.sendPasswordReset(email, link, { ...brand, byAdministrator: true, expiresInMinutes: ADMIN_RESET_TTL_SECONDS / 60 });
      } catch (err) {
        // Only the provider's words: never the link. The link that didn't go never works.
        deps.logger?.warn('password reset email could not be sent', { userId, error: err instanceof Error ? err.message : String(err) });
        await deps.store.consumeAllForUser(userId).catch(() => undefined);
        return refuse('DELIVERY_FAILED', email);
      }
      return { userId, email, sent: true, sentAt: at.toISOString() };
    } finally {
      issuing.delete(userId);
    }
  }

  const isConfigured = () => !deps.mailer.isConfigured || deps.mailer.isConfigured();

  return { requestReset, resetPassword, linkStatus, sendForAdministrator, isConfigured };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;
