import type { PrismaClient } from '@prisma/client';
import type { CreateAuditData } from '../audit/audit-repository';

/**
 * Onboarding: an invitation (welcome email) link not used within its 7 days expires. Every hour the
 * expired ones are ended (marked at their expiry) and each is audited once — "user.invitation.expired"
 * — so the audit log tells the whole story: sent, resent, expired, used. Ending one is a conditional
 * write, so two servers sweeping at once still audit it once.
 */
export interface ExpiredInvitationStore {
  /** Unused invitation links whose time is up (oldest first). */
  expiredOpen(now: Date, limit: number): Promise<{ id: string; userId: string; createdAt: Date; expiresAt: Date }[]>;
  /** End it (at its expiry) while still unused; false when another sweep or a use got there first. */
  end(id: string, at: Date): Promise<boolean>;
}

export function createInvitationSweep(deps: { store: ExpiredInvitationStore; audit?: { record(entry: CreateAuditData): Promise<unknown> }; now?: () => Date; batch?: number }) {
  const now = deps.now ?? (() => new Date());
  const batch = deps.batch ?? 200;
  return {
    /** End and audit what has expired; how many. */
    async run(): Promise<number> {
      const due = await deps.store.expiredOpen(now(), batch);
      let ended = 0;
      for (const link of due) {
        if (!(await deps.store.end(link.id, link.expiresAt))) continue;
        ended += 1;
        await deps.audit?.record({
          userId: null,
          ip: null,
          module: 'users',
          action: 'user.invitation.expired',
          entityId: link.userId,
          newValue: { sentAt: link.createdAt.toISOString(), expiredAt: link.expiresAt.toISOString() },
        });
      }
      return ended;
    },
  };
}

export function createPrismaExpiredInvitationStore(prisma: PrismaClient): ExpiredInvitationStore {
  return {
    async expiredOpen(now, limit) {
      return prisma.loginOtp.findMany({
        where: { purpose: 'WELCOME', consumedAt: null, expiresAt: { lte: now } },
        select: { id: true, userId: true, createdAt: true, expiresAt: true },
        orderBy: { expiresAt: 'asc' },
        take: limit,
      });
    },
    async end(id, at) {
      const { count } = await prisma.loginOtp.updateMany({ where: { id, purpose: 'WELCOME', consumedAt: null }, data: { consumedAt: at } });
      return count === 1;
    },
  };
}
