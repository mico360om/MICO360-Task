import { Prisma, type PrismaClient, type DailyTaskEmail } from '@prisma/client';
import type { DailyEmailRecord, DailyEmailRepository } from './daily-email-repository';

const toRecord = (r: DailyTaskEmail): DailyEmailRecord => ({
  id: r.id,
  userId: r.userId,
  day: r.day,
  kind: r.kind,
  status: r.status,
  attempts: r.attempts,
  taskCount: r.taskCount,
  nextAttemptAt: r.nextAttemptAt,
  lastError: r.lastError,
  sentAt: r.sentAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** The system_settings row that keeps when the sweep last checked (not a setting: never in the settings API). */
export const DAILY_EMAIL_CHECK_KEY = 'dailyEmails.lastCheckedAt';

/** When the daily-email sweep last checked, kept in the database so every server and a restart know it. */
export function createPrismaDailyEmailCheckStore(prisma: PrismaClient) {
  return {
    async record(at: Date): Promise<void> {
      const value = { at: at.toISOString() };
      const { count } = await prisma.systemSetting.updateMany({ where: { key: DAILY_EMAIL_CHECK_KEY }, data: { value } });
      if (count) return;
      try {
        await prisma.systemSetting.create({ data: { key: DAILY_EMAIL_CHECK_KEY, value } });
      } catch (err) {
        // Another server wrote the first one at the same moment: write ours over it.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        await prisma.systemSetting.updateMany({ where: { key: DAILY_EMAIL_CHECK_KEY }, data: { value } });
      }
    },
    async last(): Promise<Date | null> {
      const row = await prisma.systemSetting.findUnique({ where: { key: DAILY_EMAIL_CHECK_KEY } });
      const at = (row?.value as { at?: unknown } | null | undefined)?.at;
      return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
    },
  };
}

export function createPrismaDailyEmailRepository(prisma: PrismaClient): DailyEmailRepository {
  return {
    async claim(userId, day, kind) {
      try {
        return toRecord(await prisma.dailyTaskEmail.create({ data: { userId, day, kind, status: 'SENDING', attempts: 1 } }));
      } catch (err) {
        // The unique (person, day, email) row exists: it was sent, or another sweep is sending it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
        throw err;
      }
    },

    async dueForRetry(now, staleBefore) {
      const rows = await prisma.dailyTaskEmail.findMany({
        where: { OR: [{ status: 'RETRY', nextAttemptAt: { lte: now } }, { status: 'SENDING', updatedAt: { lt: staleBefore } }] },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      return rows.map(toRecord);
    },

    async retake(row) {
      // Only if nobody else took it since it was read: the same status and attempt count.
      const { count } = await prisma.dailyTaskEmail.updateMany({
        where: { id: row.id, status: row.status, attempts: row.attempts },
        data: { status: 'SENDING', attempts: row.attempts + 1, nextAttemptAt: null },
      });
      if (count !== 1) return null;
      const taken = await prisma.dailyTaskEmail.findUnique({ where: { id: row.id } });
      return taken ? toRecord(taken) : null;
    },

    async finish(taken, patch) {
      // Only the attempt that holds the row: still SENDING, at the attempt count it took it at.
      const { count } = await prisma.dailyTaskEmail.updateMany({
        where: { id: taken.id, status: 'SENDING', attempts: taken.attempts },
        data: {
          status: patch.status,
          ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
          ...(patch.taskCount !== undefined ? { taskCount: patch.taskCount } : {}),
          ...(patch.nextAttemptAt !== undefined ? { nextAttemptAt: patch.nextAttemptAt } : {}),
          ...(patch.lastError !== undefined ? { lastError: patch.lastError?.slice(0, 2000) ?? null } : {}),
          ...(patch.sentAt !== undefined ? { sentAt: patch.sentAt } : {}),
        },
      });
      return count === 1;
    },

    async find(userId, day, kind) {
      const row = await prisma.dailyTaskEmail.findUnique({ where: { userId_day_kind: { userId, day, kind } } });
      return row ? toRecord(row) : null;
    },

    async forDays(days) {
      if (!days.length) return [];
      const rows = await prisma.dailyTaskEmail.findMany({
        where: { day: { in: days } },
        include: { user: { select: { firstName: true, lastName: true, username: true, email: true, preferredTimeZone: true } } },
      });
      return rows.map((r) => ({
        ...toRecord(r),
        userName: [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') || r.user.username,
        email: r.user.email,
        timeZone: r.user.preferredTimeZone ?? null,
      }));
    },

    async list({ day, status, limit = 200 }) {
      const rows = await prisma.dailyTaskEmail.findMany({
        where: { ...(day ? { day } : {}), ...(status ? { status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(Math.max(limit, 1), 500),
        include: { user: { select: { firstName: true, lastName: true, username: true, email: true } } },
      });
      return rows.map((r) => ({
        ...toRecord(r),
        userName: [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') || r.user.username,
        email: r.user.email,
      }));
    },
  };
}
