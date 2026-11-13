import { Prisma, type PrismaClient, type ErrorGroup, type ErrorEvent } from '@prisma/client';
import { EVENTS_KEPT, nextGroupState, type ErrorEventRow, type ErrorGroupRow, type ErrorLogRepository } from './error-log-repository';
import type { ErrorKind } from './error-log-rules';

/** An administrator's last visit to the Error log: a hidden system setting row (never in the settings API). */
const visitKey = (userId: string) => `errorLog.lastVisit.${userId}`;

function groupRow(g: ErrorGroup): ErrorGroupRow {
  return {
    id: g.id,
    fingerprint: g.fingerprint,
    kind: g.kind as ErrorKind,
    title: g.title,
    topFile: g.topFile,
    topLine: g.topLine,
    topFunction: g.topFunction,
    count: g.count,
    people: Array.isArray(g.people) ? (g.people as unknown[]).filter((p): p is string => typeof p === 'string') : [],
    peopleCount: g.peopleCount,
    firstSeenAt: g.firstSeenAt,
    lastSeenAt: g.lastSeenAt,
    lastVersion: g.lastVersion,
    status: g.status === 'FIXED' ? 'FIXED' : 'OPEN',
    fixedAt: g.fixedAt,
    fixedById: g.fixedById,
    fixedInVersion: g.fixedInVersion,
    reopenedAt: g.reopenedAt,
  };
}

function eventRow(e: ErrorEvent): ErrorEventRow {
  return {
    id: e.id,
    groupId: e.groupId,
    at: e.at,
    kind: e.kind as ErrorKind,
    detail: e.detail,
    message: e.message,
    stack: e.stack,
    page: e.page,
    job: e.job,
    resource: e.resource,
    value: e.value,
    count: e.count,
    version: e.version,
    browser: e.browser,
    system: e.system,
    screen: e.screen,
    userId: e.userId,
    signedIn: e.signedIn,
  };
}

const isUniqueClash = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** The Error log in MySQL (error_groups, error_events). */
export function createPrismaErrorLogRepository(prisma: PrismaClient): ErrorLogRepository {
  async function get(id: string): Promise<ErrorGroupRow | null> {
    const g = await prisma.errorGroup.findUnique({ where: { id } });
    return g ? groupRow(g) : null;
  }

  async function keepNewest(groupId: string): Promise<void> {
    const old = await prisma.errorEvent.findMany({ where: { groupId }, orderBy: [{ at: 'desc' }, { id: 'desc' }], skip: EVENTS_KEPT, select: { id: true } });
    if (old.length) await prisma.errorEvent.deleteMany({ where: { id: { in: old.map((x) => x.id) } } });
  }

  return {
    async record(o, opts) {
      const e = o.event;
      // Two reports of a new error at once: the second create meets the unique fingerprint and adds to the first.
      for (let attempt = 0; attempt < 3; attempt++) {
        const found = await prisma.errorGroup.findUnique({ where: { fingerprint: o.fingerprint } });
        if (!found && opts?.create === false) return null;
        if (!found) {
          try {
            const created = await prisma.errorGroup.create({
              data: {
                fingerprint: o.fingerprint,
                kind: o.kind,
                title: o.title,
                topFile: o.topFile,
                topLine: o.topLine,
                topFunction: o.topFunction,
                count: e.count,
                people: e.userId ? [e.userId] : [],
                peopleCount: e.userId ? 1 : 0,
                firstSeenAt: e.at,
                lastSeenAt: e.at,
                lastVersion: e.version,
                events: { create: { ...e } },
              },
            });
            return { groupId: created.id, created: true, reopened: false };
          } catch (err) {
            if (isUniqueClash(err)) continue;
            throw err;
          }
        }
        const { patch, reopened } = nextGroupState(groupRow(found), o);
        // 1.23.27: one UPDATE statement (updateMany), not update() — Prisma's update() reads the row first in its
        // own transaction, and MariaDB (the live server, innodb_snapshot_isolation ON) then refuses the write when
        // another report changed the row in between (error 1020). The counts are increments either way.
        const { count } = await prisma.errorGroup.updateMany({
          where: { id: found.id },
          data: {
            // The count adds up whatever else is written at the same time.
            count: { increment: e.count },
            peopleCount: { increment: (patch.peopleCount ?? found.peopleCount) - found.peopleCount },
            lastSeenAt: patch.lastSeenAt,
            lastVersion: patch.lastVersion,
            people: patch.people as Prisma.InputJsonValue,
            ...(patch.title !== undefined ? { title: patch.title, topFile: patch.topFile ?? null, topLine: patch.topLine ?? null, topFunction: patch.topFunction ?? null } : {}),
            ...(reopened ? { status: 'OPEN', reopenedAt: patch.reopenedAt ?? e.at } : {}),
          },
        });
        // Removed meanwhile (the retention sweep): read again — the next turn makes it afresh.
        if (count === 0) continue;
        await prisma.errorEvent.create({ data: { ...e, groupId: found.id } });
        await keepNewest(found.id);
        return { groupId: found.id, created: false, reopened };
      }
      throw new Error('error log: the row could not be written');
    },

    async list(q) {
      const and: Prisma.ErrorGroupWhereInput[] = [{ status: q.status }, { lastSeenAt: { gte: q.since } }];
      if (q.kinds) and.push({ kind: { in: q.kinds } });
      if (q.search) {
        const s = q.search;
        and.push({ OR: [{ title: { contains: s } }, { topFile: { contains: s } }, { events: { some: { OR: [{ page: { contains: s } }, { job: { contains: s } }, { resource: { contains: s } }] } } }] });
      }
      if (q.before) and.push({ OR: [{ lastSeenAt: { lt: q.before.lastSeenAt } }, { lastSeenAt: q.before.lastSeenAt, id: { lt: q.before.id } }] });
      const rows = await prisma.errorGroup.findMany({ where: { AND: and }, orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }], take: q.limit });
      return rows.map(groupRow);
    },

    async countsByKind(since, status) {
      const rows = await prisma.errorGroup.groupBy({ by: ['kind'], where: { status, lastSeenAt: { gte: since } }, _count: { _all: true } });
      return Object.fromEntries(rows.map((r) => [r.kind, r._count._all])) as Partial<Record<ErrorKind, number>>;
    },

    async topPages(ids) {
      const out = new Map<string, string>();
      if (!ids.length) return out;
      const rows = await prisma.errorEvent.groupBy({ by: ['groupId', 'page', 'job'], where: { groupId: { in: ids } }, _sum: { count: true } });
      const best = new Map<string, { place: string; n: number }>();
      for (const r of rows) {
        const place = r.page ?? r.job;
        if (!place) continue;
        const n = r._sum.count ?? 0;
        const was = best.get(r.groupId);
        if (!was || n > was.n || (n === was.n && place < was.place)) best.set(r.groupId, { place, n });
      }
      for (const [id, b] of best) out.set(id, b.place);
      return out;
    },

    async newest(ids) {
      const out = new Map<string, { value: number | null; stack: string | null }>();
      if (!ids.length) return out;
      // At most EVENTS_KEPT a group, newest first: the first of each group is its newest.
      const rows = await prisma.errorEvent.findMany({ where: { groupId: { in: ids } }, orderBy: [{ at: 'desc' }, { id: 'desc' }], select: { groupId: true, value: true, stack: true } });
      for (const r of rows) if (!out.has(r.groupId)) out.set(r.groupId, { value: r.value, stack: r.stack });
      return out;
    },

    get,

    async events(groupId) {
      const rows = await prisma.errorEvent.findMany({ where: { groupId }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: EVENTS_KEPT });
      return rows.map(eventRow);
    },

    async setFixed(id, by, version, at) {
      const done = await prisma.errorGroup.updateMany({ where: { id }, data: { status: 'FIXED', fixedAt: at, fixedById: by, fixedInVersion: version } });
      return done.count ? get(id) : null;
    },

    async setOpen(id) {
      const done = await prisma.errorGroup.updateMany({ where: { id }, data: { status: 'OPEN', fixedAt: null, fixedById: null, fixedInVersion: null } });
      return done.count ? get(id) : null;
    },

    async prune(cutoff) {
      const events = await prisma.errorEvent.deleteMany({ where: { at: { lt: cutoff } } });
      // A row not seen since the cutoff has no kept events left (they are older still).
      const groups = await prisma.errorGroup.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
      return { groups: groups.count, events: events.count };
    },

    async lastVisit(userId) {
      const row = await prisma.systemSetting.findUnique({ where: { key: visitKey(userId) } });
      const at = typeof row?.value === 'string' ? new Date(row.value) : null;
      return at && !Number.isNaN(at.getTime()) ? at : null;
    },

    async setLastVisit(userId, at) {
      const value = at.toISOString();
      await prisma.systemSetting.upsert({ where: { key: visitKey(userId) }, update: { value }, create: { key: visitKey(userId), value } });
    },
  };
}
