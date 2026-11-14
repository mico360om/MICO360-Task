import type { PrismaClient } from '@prisma/client';
import type { TrustedBrowserStore } from './two-step';

/**
 * 1.24 two-step sign-in: trusted browsers in trusted_browsers. Every write is one statement (a create, or a
 * conditional updateMany), so a double click or a burst never meets MariaDB's 1020 between a read and a write.
 */
export function createPrismaTrustedBrowserStore(prisma: PrismaClient): TrustedBrowserStore {
  return {
    async create(row) {
      await prisma.trustedBrowser.create({ data: row });
    },
    async find(id) {
      return prisma.trustedBrowser.findUnique({ where: { id } });
    },
    async countLive(userId, sessionVersion, now) {
      return prisma.trustedBrowser.count({ where: { userId, sessionVersion, revokedAt: null, expiresAt: { gt: now } } });
    },
    async revokeAll(userId, at) {
      const { count } = await prisma.trustedBrowser.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
      return count;
    },
  };
}
