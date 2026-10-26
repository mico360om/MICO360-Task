import { Prisma, type PrismaClient } from '@prisma/client';
import { ClientShareExistsError, type ClientShareRecord, type ClientShareStore } from './client-share-store';

const shareSelect = {
  id: true,
  projectId: true,
  name: true,
  email: true,
  linkHash: true,
  createdById: true,
  linkSentAt: true,
  lastViewedAt: true,
  createdAt: true,
} satisfies Prisma.ClientShareSelect;

const isUniqueConflict = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** client_shares, client_access_codes and client_sessions (codes and sessions cascade from their share). */
export function createPrismaClientShareStore(prisma: PrismaClient): ClientShareStore {
  return {
    async listForProject(projectId) {
      return prisma.clientShare.findMany({ where: { projectId }, select: shareSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    },
    async findById(id) {
      return prisma.clientShare.findUnique({ where: { id }, select: shareSelect });
    },
    async findByLinkHash(linkHash) {
      return prisma.clientShare.findUnique({ where: { linkHash }, select: shareSelect });
    },
    async findByEmail(projectId, email) {
      return prisma.clientShare.findUnique({ where: { projectId_email: { projectId, email } }, select: shareSelect });
    },
    async create(data): Promise<ClientShareRecord> {
      try {
        return await prisma.clientShare.create({ data, select: shareSelect });
      } catch (err) {
        if (isUniqueConflict(err)) throw new ClientShareExistsError();
        throw err;
      }
    },
    async delete(id) {
      const { count } = await prisma.clientShare.deleteMany({ where: { id } });
      return count > 0;
    },
    async replaceLink(id, fromHash, toHash) {
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.clientShare.updateMany({ where: { id, linkHash: fromHash }, data: { linkHash: toHash } });
        if (count !== 1) return false;
        await tx.clientAccessCode.updateMany({ where: { shareId: id, consumedAt: null }, data: { consumedAt: new Date() } });
        return true;
      });
    },
    async markSent(id, at) {
      await prisma.clientShare.updateMany({ where: { id }, data: { linkSentAt: at } });
    },
    async markViewed(id, at) {
      await prisma.clientShare.updateMany({ where: { id }, data: { lastViewedAt: at } });
    },

    async createCode(data) {
      await prisma.$transaction([
        prisma.clientAccessCode.updateMany({ where: { shareId: data.shareId, consumedAt: null }, data: { consumedAt: new Date() } }),
        prisma.clientAccessCode.create({ data: { shareId: data.shareId, codeHash: data.codeHash, expiresAt: data.expiresAt } }),
      ]);
    },
    async latestOpenCode(shareId) {
      return prisma.clientAccessCode.findFirst({ where: { shareId, consumedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    },
    async countCodesSince(shareId, since) {
      return prisma.clientAccessCode.count({ where: { shareId, createdAt: { gte: since } } });
    },
    async countFailuresSince(shareId, since) {
      const agg = await prisma.clientAccessCode.aggregate({ where: { shareId, createdAt: { gte: since } }, _sum: { attempts: true } });
      return agg._sum.attempts ?? 0;
    },
    async claimAttempt(codeId, max) {
      const { count } = await prisma.clientAccessCode.updateMany({ where: { id: codeId, consumedAt: null, attempts: { lt: max } }, data: { attempts: { increment: 1 } } });
      return count === 1;
    },
    async consumeCode(codeId) {
      // attempts - 1: the try that succeeded isn't a failure for the per-client cap.
      const { count } = await prisma.clientAccessCode.updateMany({ where: { id: codeId, consumedAt: null }, data: { consumedAt: new Date(), attempts: { decrement: 1 } } });
      return count === 1;
    },

    async createSession(data) {
      await prisma.clientSession.create({ data });
    },
    async findSession(tokenHash) {
      return prisma.clientSession.findUnique({ where: { tokenHash }, select: { shareId: true, expiresAt: true } });
    },
    async deleteSession(tokenHash) {
      await prisma.clientSession.deleteMany({ where: { tokenHash } });
    },
    async pruneSessions(shareId, now, keep) {
      await prisma.clientSession.deleteMany({ where: { shareId, expiresAt: { lte: now } } });
      const extra = await prisma.clientSession.findMany({ where: { shareId }, select: { id: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: keep });
      if (extra.length) await prisma.clientSession.deleteMany({ where: { id: { in: extra.map((s) => s.id) } } });
    },
    async deleteSessionsFor(shareId) {
      await prisma.clientSession.deleteMany({ where: { shareId } });
    },
    async noteLockout(shareId, at, windowMs) {
      // One conditional write: two requests at once can't both note it.
      const { count } = await prisma.clientShare.updateMany({
        where: { id: shareId, OR: [{ lockoutNotedAt: null }, { lockoutNotedAt: { lte: new Date(at.getTime() - windowMs) } }] },
        data: { lockoutNotedAt: at },
      });
      return count === 1;
    },
    async prune(now) {
      await prisma.clientAccessCode.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } });
      await prisma.clientSession.deleteMany({ where: { expiresAt: { lte: now } } });
    },
  };
}
