import { Prisma, type PrismaClient } from '@prisma/client';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import type { ProjectStatus } from '../management/management-rules';
import { weightDefaultsOf, type CompletionMode } from './completion';
import type { AttentionTask, HealthSource, LinkedTask } from './health-source';
import { COUNTED_TASK, countedSql, NOT_ARCHIVED, notArchivedSql } from '../tasks/task-archive-where';

/**
 * 1.23.5 Project overview & health over the database: a fixed number of reads for a whole list of
 * projects. Raw SQL only where Prisma can't add up the way the page needs (weights, each person's open
 * tasks); every statement is in healthReads, checked portable to MariaDB by the DB tests
 * (lib/sql-portability) and sent once by the start-up database check (healthProbe). The live database is
 * MariaDB 11.8 (not strict): no constant sort terms, no LIMIT in IN (…), no RETURNING or JSON operators.
 */

const num = (v: unknown) => Number(v ?? 0);
const inList = (ids: string[]) => Prisma.join(ids);
const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;
/** Done: a Done column or a completion time (the shared rule), for a task `t` joined to its column `c`. */
const DONE = Prisma.sql`(c.category = 'DONE' OR t.completedAt IS NOT NULL)`;
/** A task's weight: its own, else its project's (`p`) default for its priority. */
const WEIGHT = Prisma.sql`COALESCE(t.weight, CASE t.priority WHEN 'URGENT' THEN p.weightUrgent WHEN 'HIGH' THEN p.weightHigh WHEN 'LOW' THEN p.weightLow ELSE p.weightNormal END)`;
/** Open and not waiting for approval (a task handed in is no work in hand) — never archived (task archive). */
const OPEN_IN_HAND: Prisma.TaskWhereInput = { deletedAt: null, ...NOT_ARCHIVED, completedAt: null, approvalRequestedAt: null, column: { category: { not: 'DONE' } } };
const MOVES = ['MOVED', 'REOPENED', 'SENT_BACK'];

const linkedSelect = { id: true, key: true, projectId: true, dueDate: true, deletedAt: true, archivedAt: true, completedAt: true, column: { select: { category: true } } } as const;
type Linked = Prisma.TaskGetPayload<{ select: typeof linkedSelect }>;
// Task archive: an archived task is never open work — an archived open blocker no longer blocks.
const linked = (t: Linked): LinkedTask => ({ id: t.id, key: t.key, projectId: t.projectId, dueDate: t.dueDate, open: !t.archivedAt && !t.completedAt && t.column.category !== 'DONE' });

/** Every statement the health extras send, in one place (the sources use them; the start-up check sends each once). */
export function healthReads(prisma: PrismaClient) {
  return {
    async projects(ids: string[]) {
      return prisma.project.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          color: true,
          icon: true,
          imageUrl: true,
          ownerId: true,
          managerId: true,
          startDate: true,
          targetDate: true,
          updatedAt: true,
          completionMode: true,
          weightUrgent: true,
          weightHigh: true,
          weightNormal: true,
          weightLow: true,
          ...ARCHIVE_SELECT,
          members: {
            where: { role: 'MANAGER', user: { deletedAt: null, status: 'ACTIVE' } },
            select: { userId: true },
            orderBy: [{ addedAt: 'asc' }, { userId: 'asc' }],
          },
        },
      });
    },
    figures(ids: string[]) {
      return prisma.$queryRaw<Array<{ projectId: string; total: unknown; done: unknown; weightTotal: unknown; weightDone: unknown; lastTaskUpdate: Date | null }>>`
        SELECT t.projectId AS projectId,
               COUNT(*) AS total,
               CAST(SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) AS SIGNED) AS done,
               CAST(SUM(${WEIGHT}) AS SIGNED) AS weightTotal,
               CAST(SUM(CASE WHEN ${DONE} THEN ${WEIGHT} ELSE 0 END) AS SIGNED) AS weightDone,
               MAX(t.updatedAt) AS lastTaskUpdate
          FROM tasks t JOIN kanban_columns c ON c.id = t.columnId JOIN projects p ON p.id = t.projectId
         WHERE t.deletedAt IS NULL AND ${countedSql('t', 'c')} AND t.projectId IN (${inList(ids)})
         GROUP BY t.projectId`;
    },
    openTotals(ids: string[]) {
      return prisma.task.groupBy({ by: ['projectId'], where: { ...OPEN_IN_HAND, projectId: { in: ids } }, _count: { _all: true } });
    },
    openByPerson(ids: string[]) {
      return prisma.$queryRaw<Array<{ projectId: string; userId: string; n: unknown }>>`
        SELECT t.projectId AS projectId, a.userId AS userId, COUNT(*) AS n
          FROM tasks t JOIN kanban_columns c ON c.id = t.columnId
          JOIN task_assignees a ON a.taskId = t.id JOIN users u ON u.id = a.userId
         WHERE t.deletedAt IS NULL AND ${notArchivedSql('t')} AND t.completedAt IS NULL AND c.category <> 'DONE' AND t.approvalRequestedAt IS NULL
           AND u.deletedAt IS NULL AND t.projectId IN (${inList(ids)})
         GROUP BY t.projectId, a.userId`;
    },
    attention(ids: string[], dueBefore: Date) {
      return prisma.task.findMany({
        where: {
          projectId: { in: ids },
          deletedAt: null,
          ...NOT_ARCHIVED,
          completedAt: null,
          column: { category: { not: 'DONE' } },
          OR: [
            { isMilestone: true },
            {
              approvalRequestedAt: null,
              OR: [{ column: { category: 'BLOCKED' } }, { dependencies: { some: {} } }, { dueDate: { lt: dueBefore } }, { assignees: { none: {} }, dueDate: { not: null } }],
            },
          ],
        },
        select: {
          id: true,
          key: true,
          title: true,
          projectId: true,
          columnId: true,
          priority: true,
          startDate: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
          version: true,
          recurrenceRule: true,
          isMilestone: true,
          approvalRequestedAt: true,
          column: { select: { category: true } },
          assignees: {
            where: { user: { deletedAt: null } },
            select: { user: { select: { id: true, firstName: true, lastName: true, username: true } } },
            orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }],
          },
        },
      });
    },
    links(taskIds: string[]) {
      return prisma.taskDependency.findMany({
        where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }], task: { deletedAt: null }, dependsOn: { deletedAt: null } },
        select: { taskId: true, dependsOnTaskId: true, task: { select: linkedSelect }, dependsOn: { select: linkedSelect } },
      });
    },
    lastMoves(taskIds: string[]) {
      return prisma.activity.groupBy({ by: ['taskId'], where: { taskId: { in: taskIds }, action: { in: MOVES } }, _max: { createdAt: true } });
    },
    dueGroups(ids: string[], dueBefore: Date) {
      const live = { projectId: { in: ids }, deletedAt: null, dueDate: { not: null, lt: dueBefore } } satisfies Prisma.TaskWhereInput;
      // Task archive: the totals keep an archived Done task (it was done on time or not); the open ones never an archived task.
      return Promise.all([
        prisma.task.groupBy({ by: ['projectId', 'dueDate'], where: { ...live, ...COUNTED_TASK }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['projectId', 'dueDate'], where: { ...live, ...NOT_ARCHIVED, completedAt: null, column: { category: { not: 'DONE' } } }, _count: { _all: true } }),
      ]);
    },
    people(ids: string[]) {
      return prisma.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } });
    },
  };
}

/** The start-up database check: every statement above, once, one after another, about nothing (an id no row has). */
export async function healthProbe(prisma: PrismaClient, nowhere: string): Promise<void> {
  const r = healthReads(prisma);
  const edge = new Date('2026-01-10T00:00:00.000Z');
  await r.projects([nowhere]);
  await r.figures([nowhere]);
  await r.openTotals([nowhere]);
  await r.openByPerson([nowhere]);
  await r.attention([nowhere], edge);
  await r.links([nowhere]);
  await r.lastMoves([nowhere]);
  await r.dueGroups([nowhere], edge);
  await r.people([nowhere]);
}

export function createPrismaHealthSource(prisma: PrismaClient): HealthSource {
  const r = healthReads(prisma);
  return {
    async projects(ids) {
      if (ids.length === 0) return [];
      return (await r.projects(ids)).map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        color: p.color,
        icon: p.icon,
        imageUrl: p.imageUrl,
        status: p.status as ProjectStatus,
        archived: archivedOf(p),
        ownerId: p.ownerId,
        managerId: p.managerId,
        managerMemberIds: p.members.map((m) => m.userId),
        startDate: p.startDate,
        targetDate: p.targetDate,
        updatedAt: p.updatedAt,
        completionMode: p.completionMode as CompletionMode,
        weights: weightDefaultsOf(p),
      }));
    },
    async figures(ids) {
      if (ids.length === 0) return [];
      return (await r.figures(ids)).map((x) => ({ projectId: x.projectId, total: num(x.total), done: num(x.done), weightTotal: num(x.weightTotal), weightDone: num(x.weightDone), lastTaskUpdate: x.lastTaskUpdate }));
    },
    async openLoad(ids) {
      if (ids.length === 0) return [];
      const [totals, people] = await Promise.all([r.openTotals(ids), r.openByPerson(ids)]);
      return totals.map((t) => ({
        projectId: t.projectId,
        open: t._count._all,
        people: people.filter((p) => p.projectId === t.projectId).map((p) => ({ userId: p.userId, count: num(p.n) })),
      }));
    },
    async attention(ids, dueBefore) {
      if (ids.length === 0) return [];
      return (await r.attention(ids, dueBefore)).map(
        (t): AttentionTask => ({
          id: t.id,
          key: t.key,
          title: t.title,
          projectId: t.projectId,
          columnId: t.columnId,
          columnCategory: t.column.category,
          priority: t.priority,
          startDate: t.startDate,
          dueDate: t.dueDate,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          version: t.version,
          recurrenceRule: t.recurrenceRule ?? null,
          isMilestone: t.isMilestone,
          waiting: t.approvalRequestedAt !== null,
          assignees: t.assignees.map((a) => ({ id: a.user.id, name: nameOf(a.user) })),
        }),
      );
    },
    async links(taskIds) {
      if (taskIds.length === 0) return [];
      return (await r.links(taskIds)).map((l) => ({ taskId: l.taskId, dependsOnTaskId: l.dependsOnTaskId, waiting: linked(l.task), blocker: linked(l.dependsOn) }));
    },
    async lastMoves(taskIds) {
      if (taskIds.length === 0) return [];
      return (await r.lastMoves(taskIds)).filter((m) => m.taskId && m._max.createdAt).map((m) => ({ taskId: m.taskId!, at: m._max.createdAt! }));
    },
    async dueGroups(ids, dueBefore) {
      if (ids.length === 0) return [];
      const [all, open] = await r.dueGroups(ids, dueBefore);
      const key = (g: { projectId: string; dueDate: Date | null }) => `${g.projectId}|${g.dueDate?.toISOString() ?? ''}`;
      const openOf = new Map(open.map((g) => [key(g), g._count._all]));
      return all.map((g) => ({ projectId: g.projectId, dueDate: g.dueDate, total: g._count._all, open: openOf.get(key(g)) ?? 0 }));
    },
    async people(ids) {
      if (ids.length === 0) return [];
      return (await r.people(ids)).map((u) => ({ id: u.id, name: nameOf(u), avatarUrl: u.avatarUrl }));
    },
  };
}
