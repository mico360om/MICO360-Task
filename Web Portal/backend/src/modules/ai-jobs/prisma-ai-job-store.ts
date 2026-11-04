import { Prisma, type PrismaClient } from '@prisma/client';
import { activeKeyOf, leaseToken, type AiJobError, type AiJobKind, type AiJobRecord, type AiJobStatus, type AiJobStore } from './ai-job-store';

/**
 * AI jobs in the ai_jobs table (1.22 §10). Every change of a job's state is one conditional
 * statement — on its status and lease token, or its try count when a server takes it — so of two
 * servers acting at the same moment only one wins; `activeKey` is unique while a job is queued or
 * running, so one thing never has two active jobs.
 */
export function createPrismaAiJobStore(prisma: PrismaClient): AiJobStore {
  type Row = Prisma.AiJobGetPayload<object>;
  const toRecord = (r: Row): AiJobRecord => ({
    id: r.id,
    kind: r.kind as AiJobKind,
    subjectId: r.subjectId,
    meetingId: r.meetingId,
    messageId: r.messageId,
    activeKey: r.activeKey,
    requestedById: r.requestedById,
    status: r.status as AiJobStatus,
    attempts: r.attempts,
    nextTryAt: r.nextTryAt,
    leaseOwner: r.leaseOwner,
    leaseUntil: r.leaseUntil,
    input: r.input && typeof r.input === 'object' && !Array.isArray(r.input) ? (r.input as Record<string, unknown>) : {},
    result: r.result ?? null,
    outcome: r.outcome,
    outcomeAt: r.outcomeAt,
    error: (r.error ?? null) as unknown as AiJobError | null,
    watchedAt: r.watchedAt,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  });
  const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));
  const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  const live = { status: { in: ['QUEUED', 'RUNNING'] } };

  return {
    async create(input, now) {
      const activeKey = activeKeyOf(input.kind, input.subjectId);
      // Two tries: the active job we would join may end between our insert and our read.
      for (let i = 0; i < 2; i++) {
        try {
          const row = await prisma.aiJob.create({
            data: {
              kind: input.kind,
              subjectId: input.subjectId,
              meetingId: input.meetingId ?? null,
              messageId: input.messageId ?? null,
              activeKey,
              requestedById: input.requestedById,
              status: 'QUEUED',
              nextTryAt: now,
              input: input.input as Prisma.InputJsonValue,
              watchedAt: input.watched ? now : null,
            },
          });
          return { job: toRecord(row), joined: false };
        } catch (err) {
          if (!isUnique(err)) throw err;
          const existing = await prisma.aiJob.findUnique({ where: { activeKey } });
          if (existing) return { job: toRecord(existing), joined: true };
        }
      }
      throw new Error('Could not add the AI job.');
    },
    async get(id) {
      const row = await prisma.aiJob.findUnique({ where: { id } });
      return row ? toRecord(row) : null;
    },
    async latest(kind, subjectId) {
      const row = await prisma.aiJob.findFirst({ where: { kind, subjectId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return row ? toRecord(row) : null;
    },
    async active(kind, subjectId) {
      const row = await prisma.aiJob.findUnique({ where: { activeKey: activeKeyOf(kind, subjectId) } });
      return row ? toRecord(row) : null;
    },
    async activeSubjects(kind, subjectIds) {
      if (subjectIds.length === 0) return new Set();
      const rows = await prisma.aiJob.findMany({ where: { activeKey: { in: subjectIds.map((s) => activeKeyOf(kind, s)) } }, select: { subjectId: true } });
      return new Set(rows.map((r) => r.subjectId));
    },
    async claimDue(owner, now, leaseMs, limit) {
      if (limit <= 0) return [];
      const due = await prisma.aiJob.findMany({
        where: { OR: [{ status: 'QUEUED', nextTryAt: { lte: now } }, { status: 'RUNNING', leaseUntil: { lt: now } }] },
        orderBy: [{ nextTryAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: { id: true, status: true, attempts: true },
      });
      const taken: AiJobRecord[] = [];
      for (const c of due) {
        const leaseOwner = leaseToken(owner);
        // Still as we found it (the try count moves on with every take): only one server wins it.
        const { count } = await prisma.aiJob.updateMany({
          where: { id: c.id, status: c.status, attempts: c.attempts, ...(c.status === 'QUEUED' ? { nextTryAt: { lte: now } } : { leaseUntil: { lt: now } }) },
          data: { status: 'RUNNING', leaseOwner, leaseUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 }, startedAt: now },
        });
        if (!count) continue;
        const row = await prisma.aiJob.findUnique({ where: { id: c.id } });
        if (row && row.leaseOwner === leaseOwner) taken.push(toRecord(row));
      }
      return taken;
    },
    async renew(id, leaseOwner, until) {
      const { count } = await prisma.aiJob.updateMany({ where: { id, leaseOwner, status: 'RUNNING' }, data: { leaseUntil: until } });
      return count > 0;
    },
    async retryAt(id, leaseOwner, at, error) {
      const { count } = await prisma.aiJob.updateMany({
        where: { id, leaseOwner, status: 'RUNNING' },
        data: { status: 'QUEUED', nextTryAt: at, leaseOwner: null, leaseUntil: null, error: error as unknown as Prisma.InputJsonValue },
      });
      return count > 0;
    },
    async finish(id, leaseOwner, end, now) {
      const { count } = await prisma.aiJob.updateMany({
        where: { id, leaseOwner, status: 'RUNNING' },
        data: {
          status: end.status,
          activeKey: null,
          leaseOwner: null,
          leaseUntil: null,
          finishedAt: now,
          ...(end.status === 'DONE' ? { result: json(end.result), error: Prisma.DbNull } : { error: end.error as unknown as Prisma.InputJsonValue }),
        },
      });
      return count > 0;
    },
    async cancel(kind, subjectId, now) {
      const row = await prisma.aiJob.findUnique({ where: { activeKey: activeKeyOf(kind, subjectId) } });
      if (!row) return null;
      const { count } = await prisma.aiJob.updateMany({
        where: { id: row.id, ...live },
        data: { status: 'CANCELLED', activeKey: null, leaseOwner: null, leaseUntil: null, finishedAt: now },
      });
      return count > 0 ? toRecord(row) : null;
    },
    async setOutcome(id, outcome, { at, from = [null] }) {
      const named = from.filter((f): f is string => f !== null);
      const or: Prisma.AiJobWhereInput[] = [...(from.includes(null) ? [{ outcome: null }] : []), ...(named.length ? [{ outcome: { in: named } }] : [])];
      if (!or.length) return false;
      const { count } = await prisma.aiJob.updateMany({ where: { id, OR: or }, data: { outcome, outcomeAt: at } });
      return count > 0;
    },
    async watch(kind, subjectId, at) {
      await prisma.aiJob.updateMany({ where: { activeKey: activeKeyOf(kind, subjectId) }, data: { watchedAt: at } });
    },
    async claimUnkept(before, limit) {
      if (limit <= 0) return [];
      const found = await prisma.aiJob.findMany({ where: { status: 'DONE', outcome: null, finishedAt: { lt: before } }, orderBy: { finishedAt: 'asc' }, take: limit, select: { id: true } });
      const taken: AiJobRecord[] = [];
      for (const f of found) {
        const { count } = await prisma.aiJob.updateMany({ where: { id: f.id, status: 'DONE', outcome: null }, data: { outcome: 'SAVING' } });
        const row = count ? await prisma.aiJob.findUnique({ where: { id: f.id } }) : null;
        if (row) taken.push(toRecord(row));
      }
      return taken;
    },
    async deleteEnded(before) {
      const { count } = await prisma.aiJob.deleteMany({ where: { activeKey: null, finishedAt: { lt: before } } });
      return count;
    },
  };
}
