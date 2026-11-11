import type { Prisma, PrismaClient } from '@prisma/client';
import type { BlockRow, CalendarStore, CalTaskBrief, ReminderRow } from './calendar-store';
import type { CalendarTaskFacts } from './calendar-routes';
import type { ReminderSweepStore, ReminderSweepTask } from './reminder-sweep';
import type { ReminderAnchor } from './task-reminders';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import { managedVisibleWhere } from '../projects/project-managers';

/**
 * Calendar scheduling's rows in MySQL / MariaDB — plain Prisma reads and writes (no raw SQL). A task's
 * blocks and reminders are read with it: a deleted (binned or merged) task, or one in a deleted project,
 * counts as gone for the routes; the calendar and the sweep hide the rest by their own rules.
 */

const TASK_BRIEF = { id: true, key: true, title: true, projectId: true, startDate: true, dueDate: true, completedAt: true, deletedAt: true } as const satisfies Prisma.TaskSelect;
/** The task as the calendar names it, with whether its project is archived (read-only, reminders not sent). */
const TASK_WITH_PROJECT = { ...TASK_BRIEF, project: { select: ARCHIVE_SELECT } } as const satisfies Prisma.TaskSelect;
const briefOf = (t: Prisma.TaskGetPayload<{ select: typeof TASK_WITH_PROJECT }>): CalTaskBrief => {
  const { project, ...rest } = t;
  return { ...rest, projectArchived: archivedOf(project) };
};
/** Live: not deleted, in a live project. (After the task archive lands, archived tasks are hidden by `archivedAt` in the rules.) */
const LIVE_TASK: Prisma.TaskWhereInput = { deletedAt: null, project: { is: { deletedAt: null } } };

const blockOf = (b: { id: string; taskId: string; userId: string; plannedById: string; startAt: Date; endAt: Date; createdAt: Date }): BlockRow => ({
  id: b.id,
  taskId: b.taskId,
  userId: b.userId,
  plannedById: b.plannedById,
  startAt: b.startAt,
  endAt: b.endAt,
  createdAt: b.createdAt,
});
const anchorOf = (v: string | null): ReminderAnchor | null => (v === 'start' || v === 'due' ? v : null);
type ReminderDbRow = Omit<ReminderRow, 'anchor'> & { anchor: string | null; updatedAt?: Date };
const reminderOf = (r: ReminderDbRow): ReminderRow => ({
  id: r.id,
  taskId: r.taskId,
  userId: r.userId,
  setById: r.setById,
  at: r.at,
  anchor: anchorOf(r.anchor),
  offsetMinutes: r.offsetMinutes,
  nextAt: r.nextAt,
  mutedAt: r.mutedAt,
  snoozedUntil: r.snoozedUntil,
  sentFor: r.sentFor,
  sentAt: r.sentAt,
  createdAt: r.createdAt,
});

export function createPrismaCalendarStore(prisma: PrismaClient): CalendarStore {
  return {
    async blocksOfTask(taskId) {
      return (await prisma.taskWorkBlock.findMany({ where: { taskId }, orderBy: [{ startAt: 'asc' }, { id: 'asc' }], take: 500 })).map(blockOf);
    },
    async block(id) {
      const b = await prisma.taskWorkBlock.findUnique({ where: { id } });
      return b ? blockOf(b) : null;
    },
    async countBlocks(taskId, userId) {
      return prisma.taskWorkBlock.count({ where: { taskId, userId } });
    },
    async addBlock(data) {
      return blockOf(await prisma.taskWorkBlock.create({ data }));
    },
    async updateBlock(id, patch) {
      return blockOf(await prisma.taskWorkBlock.update({ where: { id }, data: patch }));
    },
    async removeBlock(id) {
      await prisma.taskWorkBlock.deleteMany({ where: { id } });
    },
    async remindersOfTask(taskId, viewerId) {
      const rows = await prisma.taskReminder.findMany({ where: { taskId, OR: [{ userId: viewerId }, { setById: viewerId }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500 });
      return rows.map(reminderOf);
    },
    async reminder(id) {
      const r = await prisma.taskReminder.findUnique({ where: { id } });
      return r ? reminderOf(r) : null;
    },
    async countReminders(taskId, userId) {
      return prisma.taskReminder.count({ where: { taskId, userId } });
    },
    async addReminder(data) {
      return reminderOf(await prisma.taskReminder.create({ data }));
    },
    async updateReminder(id, patch) {
      return reminderOf(await prisma.taskReminder.update({ where: { id }, data: patch }));
    },
    async removeReminder(id) {
      await prisma.taskReminder.deleteMany({ where: { id } });
    },
    async blocksBetween(q) {
      const rows = await prisma.taskWorkBlock.findMany({
        where: {
          startAt: { lt: q.to },
          endAt: { gt: q.from },
          ...(q.userId ? { userId: q.userId } : {}),
          task: { is: { ...LIVE_TASK, ...(q.projectIds ? { projectId: { in: q.projectIds } } : {}) } },
        },
        include: { task: { select: TASK_WITH_PROJECT } },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        // A busy month of a large team stays bounded.
        take: 3000,
      });
      return rows.map((b) => ({ ...blockOf(b), task: briefOf(b.task) }));
    },
    async remindersForCalendar(q) {
      const rows = await prisma.taskReminder.findMany({
        where: {
          userId: q.userId,
          task: { is: LIVE_TASK },
          OR: [
            { at: { gte: q.from, lt: q.to } },
            { snoozedUntil: { gte: q.from, lt: q.to } },
            // Before a start or due: worked out from the task's dates now (open tasks only — a done one's are hidden).
            { anchor: { not: null }, task: { is: { completedAt: null } } },
          ],
        },
        include: { task: { select: TASK_WITH_PROJECT } },
        orderBy: [{ nextAt: 'asc' }, { id: 'asc' }],
        take: 2000,
      });
      return rows.map((r) => ({ ...reminderOf(r), task: briefOf(r.task) }));
    },
    async prefs(userId) {
      return (await prisma.calendarPreference.findUnique({ where: { userId } }))?.prefs ?? null;
    },
    async savePrefs(userId, prefs) {
      const value = prefs as Prisma.InputJsonValue;
      await prisma.calendarPreference.upsert({ where: { userId }, create: { userId, prefs: value }, update: { prefs: value } });
    },
  };
}

/** The task as the routes read it (with its assignees), or null when it doesn't exist or is deleted. */
export async function calendarTaskFacts(prisma: PrismaClient, taskId: string): Promise<CalendarTaskFacts | null> {
  const t = await prisma.task.findFirst({
    where: { id: taskId, ...LIVE_TASK },
    select: { ...TASK_BRIEF, createdById: true, assignees: { select: { userId: true } } },
  });
  if (!t) return null;
  const { assignees, ...rest } = t;
  return { ...rest, assigneeIds: assignees.map((a) => a.userId) };
}

/** The projects a non-administrator runs (and may see), inside `list`; an administrator: `list` (null: all). */
export async function teamProjectIds(prisma: PrismaClient, viewer: { id: string; roles: string[] }, list: string[] | null): Promise<string[] | null> {
  if (viewer.roles.includes('ADMIN')) return list;
  const rows = await prisma.project.findMany({ where: { AND: [{ deletedAt: null }, managedVisibleWhere(viewer.id), ...(list ? [{ id: { in: list } }] : [])] }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The reminder sweep's reads and writes. */
export function createPrismaReminderSweepStore(prisma: PrismaClient): ReminderSweepStore {
  const SELECT = { id: true, taskId: true, userId: true, setById: true, at: true, anchor: true, offsetMinutes: true, nextAt: true, mutedAt: true, snoozedUntil: true, sentFor: true, sentAt: true, createdAt: true } as const;
  return {
    async dueBetween(from, to) {
      // Only ones still to go: a sent one's nextAt is cleared (until its time changes again).
      const rows = await prisma.taskReminder.findMany({
        where: { nextAt: { gte: from, lte: to }, mutedAt: null, task: { is: { deletedAt: null, completedAt: null } } },
        select: SELECT,
        orderBy: [{ nextAt: 'asc' }, { id: 'asc' }],
        take: 5000,
      });
      return rows.map(reminderOf);
    },
    async relativeChangedSince(since) {
      const rows = await prisma.taskReminder.findMany({
        where: {
          anchor: { not: null },
          // Every one of an open task at first (so after a restart a date moved meanwhile is caught); then only
          // those whose task changed since.
          task: { is: { deletedAt: null, completedAt: null, ...(since ? { updatedAt: { gte: since } } : {}) } },
        },
        select: SELECT,
        take: 20_000,
      });
      return rows.map(reminderOf);
    },
    async tasks(ids) {
      if (ids.length === 0) return new Map();
      const rows = await prisma.task.findMany({
        where: { id: { in: ids } },
        select: { ...TASK_BRIEF, project: { select: { deletedAt: true, ...ARCHIVE_SELECT } }, assignees: { select: { userId: true } } },
      });
      return new Map(
        rows.map((t): [string, ReminderSweepTask] => {
          const { project, assignees, ...rest } = t;
          return [t.id, { ...rest, deletedAt: rest.deletedAt ?? project.deletedAt, projectArchived: archivedOf(project), assigneeIds: assignees.map((a) => a.userId) }];
        }),
      );
    },
    async setNextAt(id, nextAt, expect) {
      await prisma.taskReminder.updateMany({ where: { id, nextAt: expect }, data: { nextAt } });
    },
    async markSent(id, p) {
      // Only if nobody changed its time meanwhile (that change wins; the next run reads it).
      await prisma.taskReminder.updateMany({
        where: { id, nextAt: p.expectNextAt },
        data: { sentFor: p.sentFor, sentAt: p.sentAt, nextAt: p.nextAt, ...(p.clearSnooze ? { snoozedUntil: null } : {}) },
      });
    },
  };
}

/** Claim one send in reminder_logs (false: another run or server already did). */
export function createPrismaReminderClaims(prisma: PrismaClient) {
  return {
    async claim(key: string): Promise<boolean> {
      const { count } = await prisma.reminderLog.createMany({ data: [{ dedupeKey: key }], skipDuplicates: true });
      return count === 1;
    },
  };
}

/** The blocks of live, open tasks overlapping a range (Workload's planned hours, free times' busy time). */
export async function blocksForWorkload(prisma: PrismaClient, q: { userIds: string[] | null; from: Date; to: Date; projectIds: string[] | null }) {
  if (q.userIds && q.userIds.length === 0) return [];
  return prisma.taskWorkBlock.findMany({
    where: {
      startAt: { lt: q.to },
      endAt: { gt: q.from },
      ...(q.userIds ? { userId: { in: q.userIds } } : {}),
      task: { is: { ...LIVE_TASK, completedAt: null, ...(q.projectIds ? { projectId: { in: q.projectIds } } : {}) } },
    },
    select: { id: true, userId: true, startAt: true, endAt: true },
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    take: 20_000,
  });
}
