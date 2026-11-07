import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { isStrongPassword } from '../../lib/password-policy';
import { InvalidCredentialsError, PasswordChangeExpiredError, PasswordChangeRequiredError, SameAsTemporaryPasswordError, TemporaryPasswordExpiredError, WeakPasswordError } from './errors';

/**
 * 1.23.6: the forced change after a temporary password. A temporary password (an administrator gave it)
 * signs in only as far as "Choose your own password": the website gets a short step ticket (15 minutes),
 * every other caller (the Android app, the extension) is told to use the website first. The ticket is
 * signed with a key of its own and bound to the temporary password and the session version, so it works
 * once (the password it was made for is gone afterwards) and ends with any sign-out-everywhere.
 */
export interface FirstPasswordState {
  mustChange: boolean;
  expiresAt: Date | null;
  passwordHash: string;
  tokenVersion: number;
  /** ACTIVE and not deleted. */
  active: boolean;
  /** An administrator cancelled the invitation: no way in at all until a new invitation or temporary password. */
  cancelled: boolean;
}

export interface FirstPasswordRepo {
  state(userId: string): Promise<FirstPasswordState | null>;
  /**
   * Their own password, only while the temporary one is still the one in place (`expectedHash`): the
   * mark goes, a lock lifts, every older session ends (token version), the account is theirs.
   */
  complete(userId: string, expectedHash: string, newHash: string, at: Date): Promise<boolean>;
}

export interface FirstPasswordDeps {
  repo: FirstPasswordRepo;
  /** The signing key (derived from the server's secret for this one use). */
  key: string;
  hashPassword: (plain: string) => Promise<string>;
  verifyPassword: (plain: string, hash: string) => Promise<boolean>;
  now?: () => Date;
  ticketTtlMs?: number;
}

const TICKET_TTL_MS = 15 * 60_000;

export function createFirstPassword(deps: FirstPasswordDeps) {
  const now = deps.now ?? (() => new Date());
  const ttl = deps.ticketTtlMs ?? TICKET_TTL_MS;
  const sign = (body: string) => createHmac('sha256', deps.key).update(`first-password:${body}`).digest('base64url');
  // Ties the ticket to this temporary password and this session version, without carrying either.
  const fingerprint = (s: FirstPasswordState) => createHash('sha256').update(`${s.passwordHash}:${s.tokenVersion}`).digest('base64url').slice(0, 22);

  const expired = (s: FirstPasswordState) => s.mustChange && !!s.expiresAt && s.expiresAt.getTime() <= now().getTime();

  /**
   * After the right password: a cancelled invitation signs nobody in (the same answer as a wrong password),
   * and an unused temporary password past its lifetime stops here.
   */
  async function refuseUnusable(userId: string): Promise<void> {
    const s = await deps.repo.state(userId);
    if (s?.cancelled) throw new InvalidCredentialsError();
    if (s && expired(s)) throw new TemporaryPasswordExpiredError();
  }

  /**
   * Before a session: null when there is nothing to change; the step for the website; a refusal with
   * plain words for anyone else. After a password sign-in the lifetime is checked again (the emailed-code
   * step may have taken a while); after an emailed sign-in code (the mailbox is proven, as with Forgot
   * password) the step is given even past it.
   */
  async function gate(userId: string, website: boolean, opts: { viaEmailCode?: boolean } = {}): Promise<{ ticket: string; expiresAt: string } | null> {
    const s = await deps.repo.state(userId);
    if (!s || !s.mustChange) return null;
    if (!opts.viaEmailCode && expired(s)) throw new TemporaryPasswordExpiredError();
    if (!website) throw new PasswordChangeRequiredError();
    const exp = now().getTime() + ttl;
    const body = Buffer.from(JSON.stringify({ u: userId, e: exp, f: fingerprint(s), m: opts.viaEmailCode ? 'c' : 'p' })).toString('base64url');
    return { ticket: `${body}.${sign(body)}`, expiresAt: new Date(exp).toISOString() };
  }

  function read(ticket: string): { userId: string; fp: string; viaEmailCode: boolean } | null {
    if (typeof ticket !== 'string') return null;
    const [body, sig, extra] = ticket.split('.');
    if (!body || !sig || extra !== undefined) return null;
    const want = Buffer.from(sign(body));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown; f?: unknown; m?: unknown };
      if (typeof p.u !== 'string' || typeof p.f !== 'string' || typeof p.e !== 'number' || p.e < now().getTime()) return null;
      return { userId: p.u, fp: p.f, viaEmailCode: p.m === 'c' };
    } catch {
      return null;
    }
  }

  /** "Choose your own password": the user it signs in, or a refusal. */
  async function change(ticket: string, password: string): Promise<string> {
    const t = read(ticket);
    if (!t) throw new PasswordChangeExpiredError();
    const s = await deps.repo.state(t.userId);
    if (!s || !s.active || s.cancelled || !s.mustChange || fingerprint(s) !== t.fp) throw new PasswordChangeExpiredError();
    // A step from a password sign-in: the temporary password must still be in its lifetime now.
    if (!t.viaEmailCode && expired(s)) throw new TemporaryPasswordExpiredError();
    if (!isStrongPassword(password)) throw new WeakPasswordError();
    if (await deps.verifyPassword(password, s.passwordHash)) throw new SameAsTemporaryPasswordError();
    const done = await deps.repo.complete(t.userId, s.passwordHash, await deps.hashPassword(password), now());
    if (!done) throw new PasswordChangeExpiredError();
    return t.userId;
  }

  /** A cancelled invitation: no session may go on (a refresh is refused). */
  async function cancelled(userId: string): Promise<boolean> {
    return (await deps.repo.state(userId))?.cancelled === true;
  }

  return { refuseUnusable, gate, change, cancelled };
}

export type FirstPassword = ReturnType<typeof createFirstPassword>;

export function createPrismaFirstPasswordRepo(prisma: PrismaClient): FirstPasswordRepo {
  return {
    async state(userId) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { mustChangePassword: true, temporaryPasswordExpiresAt: true, passwordHash: true, tokenVersion: true, status: true, deletedAt: true, invitationCancelledAt: true },
      });
      if (!u) return null;
      return {
        mustChange: u.mustChangePassword,
        expiresAt: u.temporaryPasswordExpiresAt,
        passwordHash: u.passwordHash,
        tokenVersion: u.tokenVersion,
        active: u.status === 'ACTIVE' && u.deletedAt === null,
        cancelled: u.invitationCancelledAt !== null,
      };
    },
    async complete(userId, expectedHash, newHash, at) {
      const { count } = await prisma.user.updateMany({
        where: { id: userId, mustChangePassword: true, passwordHash: expectedHash, status: 'ACTIVE', deletedAt: null },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
          temporaryPasswordSetAt: null,
          temporaryPasswordSetById: null,
          temporaryPasswordExpiresAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          tokenVersion: { increment: 1 },
        },
      });
      if (count !== 1) return false;
      await prisma.user.updateMany({ where: { id: userId, activatedAt: null }, data: { activatedAt: at } });
      // Links sent earlier must not set a password over the one just chosen.
      await prisma.loginOtp.updateMany({ where: { userId, purpose: { in: ['PASSWORD_RESET', 'WELCOME'] }, consumedAt: null }, data: { consumedAt: at } });
      return true;
    },
  };
}
