import type { PrismaClient } from '@prisma/client';
import type { CreateAuditData } from '../audit/audit-repository';

/**
 * Onboarding: is a person's email address confirmed, and must this sign-in ask for an emailed code?
 *
 * An address is confirmed (users.emailVerifiedAt) when an invitation or reset link is used, an emailed
 * code is entered (the sign-in challenge, or the email-code sign-in on the website or the app), or an
 * administrator marks it by hand (audited, with a reason). Everyone who had signed in before this release
 * was confirmed by the migration, so no current user is ever locked out.
 *
 * A code is asked for only while the server can send email (no mail settings: nothing is asked, as
 * before), and never of the last administrator who could let anyone in: an administrator is exempt while
 * no OTHER active administrator has a confirmed address.
 */
export interface VerificationPerson {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  roles: string[];
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export interface VerificationRepo {
  /** A non-deleted person, or null. */
  find(userId: string): Promise<VerificationPerson | null>;
  /** Active, non-deleted administrators other than this one whose address is confirmed. */
  otherVerifiedAdmins(userId: string): Promise<number>;
  /**
   * Confirm the address now (and the account as theirs when it isn't yet) — only while it is still
   * unconfirmed and, when `email` is given, still that address. True when it changed.
   */
  markVerified(userId: string, at: Date, email?: string): Promise<boolean>;
}

/** How an address was confirmed (the audit entry says so). */
export type VerifiedHow = 'code' | 'sign-in code' | 'invitation' | 'reset link' | 'administrator';

export interface EmailVerificationDeps {
  repo: VerificationRepo;
  /** False when no mail provider is configured: nothing is asked. */
  mailConfigured: () => boolean;
  audit?: { record(entry: CreateAuditData): Promise<unknown> };
  now?: () => Date;
}

export function createEmailVerification(deps: EmailVerificationDeps) {
  const now = deps.now ?? (() => new Date());

  /** Must this person enter an emailed code before a session is given? */
  async function needsCode(userId: string): Promise<boolean> {
    if (!deps.mailConfigured()) return false;
    const p = await deps.repo.find(userId);
    if (!p || p.emailVerifiedAt) return false;
    if (p.roles.includes('ADMIN') && (await deps.repo.otherVerifiedAdmins(userId)) === 0) return false;
    return true;
  }

  /**
   * The person proved the mailbox (or an administrator vouched for it). 'verified' (written and audited),
   * 'already' (nothing to do), 'address-changed' (the proof was for an address the account no longer has).
   */
  async function confirm(
    userId: string,
    how: VerifiedHow,
    opts: { email?: string; actorId?: string | null; ip?: string | null; reason?: string } = {},
  ): Promise<'verified' | 'already' | 'address-changed' | 'not-found'> {
    const p = await deps.repo.find(userId);
    if (!p) return 'not-found';
    if (p.emailVerifiedAt) return 'already';
    if (opts.email !== undefined && p.email.trim().toLowerCase() !== opts.email.trim().toLowerCase()) return 'address-changed';
    const changed = await deps.repo.markVerified(userId, now(), opts.email ?? p.email);
    if (!changed) return (await deps.repo.find(userId))?.emailVerifiedAt ? 'already' : 'address-changed';
    await deps.audit?.record({
      userId: opts.actorId ?? userId,
      ip: opts.ip ?? null,
      module: 'users',
      action: 'user.email.verified',
      entityId: userId,
      newValue: { how, email: p.email, ...(opts.reason ? { reason: opts.reason } : {}) },
    });
    return 'verified';
  }

  return { needsCode, confirm, mailConfigured: deps.mailConfigured };
}

export type EmailVerification = ReturnType<typeof createEmailVerification>;

/** The Prisma side of email verification. */
export function createPrismaVerificationRepo(prisma: PrismaClient): VerificationRepo {
  return {
    async find(userId) {
      const u = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, email: true, emailVerifiedAt: true, status: true, roles: { select: { role: { select: { name: true } } } } },
      });
      return u ? { id: u.id, email: u.email, emailVerifiedAt: u.emailVerifiedAt, status: u.status, roles: u.roles.map((r) => r.role.name) } : null;
    },
    async otherVerifiedAdmins(userId) {
      return prisma.user.count({
        where: { id: { not: userId }, status: 'ACTIVE', deletedAt: null, emailVerifiedAt: { not: null }, roles: { some: { role: { name: 'ADMIN' } } } },
      });
    },
    async markVerified(userId, at, email) {
      const { count } = await prisma.user.updateMany({
        where: { id: userId, deletedAt: null, emailVerifiedAt: null, ...(email !== undefined ? { email: email.trim() } : {}) },
        data: { emailVerifiedAt: at },
      });
      if (count === 1) await prisma.user.updateMany({ where: { id: userId, activatedAt: null }, data: { activatedAt: at } });
      return count === 1;
    },
  };
}
