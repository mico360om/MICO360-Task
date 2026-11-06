import type { PrismaClient } from '@prisma/client';
import type { ChallengeKind, ChallengeRow, SignInChallengeStore } from './sign-in-challenge';

type Row = Awaited<ReturnType<PrismaClient['signInChallenge']['findFirst']>>;
const toRow = (r: NonNullable<Row>): ChallengeRow => ({ ...r, kind: r.kind as ChallengeKind });

/** Sign-in challenges in sign_in_challenges (only hashes are stored). Every write is conditional, so parallel requests can't both pass. */
export function createPrismaSignInChallengeStore(prisma: PrismaClient): SignInChallengeStore {
  return {
    async findOpen(userId, kind, sentTo, now) {
      // sentTo compares as the column's collation does (case-insensitive), as the users' email does.
      const r = await prisma.signInChallenge.findFirst({
        where: { userId, kind, sentTo, consumedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      });
      return r ? toRow(r) : null;
    },
    async create(row) {
      await prisma.signInChallenge.create({ data: { ...row, attempts: 0 } });
    },
    async rotateToken(id, tokenHash) {
      const { count } = await prisma.signInChallenge.updateMany({ where: { id, consumedAt: null }, data: { tokenHash } });
      return count === 1;
    },
    async findByTokenHash(tokenHash) {
      const r = await prisma.signInChallenge.findUnique({ where: { tokenHash } });
      return r ? toRow(r) : null;
    },
    async recordSend(id, { codeHash, at, expiresAt }) {
      const { count } = await prisma.signInChallenge.updateMany({
        where: { id, consumedAt: null },
        data: { codeHash, lastSentAt: at, expiresAt, sends: { increment: 1 } },
      });
      return count === 1;
    },
    async sendsSince(userId, since) {
      const agg = await prisma.signInChallenge.aggregate({ where: { userId, lastSentAt: { gte: since } }, _sum: { sends: true } });
      return agg._sum.sends ?? 0;
    },
    async failuresSince(userId, since) {
      const agg = await prisma.signInChallenge.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { attempts: true } });
      return agg._sum.attempts ?? 0;
    },
    async claimAttempt(id, max) {
      const { count } = await prisma.signInChallenge.updateMany({
        where: { id, consumedAt: null, attempts: { lt: max } },
        data: { attempts: { increment: 1 } },
      });
      return count === 1;
    },
    async consume(id, at) {
      // attempts - 1: the right guess isn't a failure for the account's hourly cap.
      const { count } = await prisma.signInChallenge.updateMany({
        where: { id, consumedAt: null },
        data: { consumedAt: at, attempts: { decrement: 1 } },
      });
      return count === 1;
    },
    async endAll(userId, at) {
      await prisma.signInChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: at } });
    },
  };
}
