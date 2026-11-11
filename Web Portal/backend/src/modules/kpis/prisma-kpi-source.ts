import { Prisma, type PrismaClient } from '@prisma/client';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import type { ProjectStatus } from '../management/management-rules';
import { weightDefaultsOf, type CompletionMode } from '../project-health/completion';
import { matchMentions } from '../tasks/mentions';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';
import { KPI_TASK_WHERE } from './kpi-task-scope';
import type { ConversationItem, KpiPerson, KpiProjectRow, KpiSource } from './kpi-source';
import type { HistoryEvent, KpiPriority, KpiTask } from './task-history';

/**
 * The KPIs' reads over the database: a fixed number of statements per chunk of projects or tasks, never
 * one per task. Raw SQL only for the weighted count of tasks finished before a moment (the health rule's
 * weight expression); everything is in kpiReads, checked portable to MariaDB by the DB tests and sent once
 * by the start-up database check (kpiProbe). The live database is MariaDB 11.8 (not strict): no constant
 * sort terms, no LIMIT in IN (…), no RETURNING or JSON operators.
 */

/** The timeline lines a task's KPIs read: due-date edits, people on and off it, approvals and moves. */
export const KPI_ACTIONS = ['UPDATED', 'ASSIGNED', 'UNASSIGNED', 'APPROVAL_REQUESTED', 'APPROVED', 'SENT_BACK', 'APPROVAL_WITHDRAWN', 'COMPLETED', 'REOPENED', 'MOVED'] as const;
/** A status change by someone answers what was waiting for them (update responsiveness). */
export const STATUS_ACTIONS = ['MOVED', 'COMPLETED', 'REOPENED', 'APPROVAL_REQUESTED', 'APPROVED', 'SENT_BACK', 'APPROVAL_WITHDRAWN'] as const;
const MOVES = ['MOVED', 'REOPENED', 'SENT_BACK'];

const CHUNK = 500;
const chunks = <T>(list: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const num = (v: unknown) => Number(v ?? 0);
const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;
/** A task's weight: its own, else its project's (`p`) default for its priority. */
const WEIGHT = Prisma.sql`COALESCE(t.weight, CASE t.priority WHEN 'URGENT' THEN p.weightUrgent WHEN 'HIGH' THEN p.weightHigh WHEN 'LOW' THEN p.weightLow ELSE p.weightNormal END)`;

const taskSelect = {
  id: true,
  key: true,
  title: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  approvalRequestedAt: true,
  priority: true,
  weight: true,
  column: { select: { category: true } },
  assignees: { select: { userId: true, assignedAt: true }, orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }] },
} as const satisfies Prisma.TaskSelect;

/** Every statement the KPIs send, in one place (the source uses them; the start-up check sends each once). */
export function kpiReads(prisma: PrismaClient) {
  return {
    projects(ids: string[]) {
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
          completionMode: true,
          weightUrgent: true,
          weightHigh: true,
          weightNormal: true,
          weightLow: true,
          mainCompanyId: true,
          ...ARCHIVE_SELECT,
          members: { where: { role: 'MANAGER' }, select: { userId: true }, orderBy: [{ addedAt: 'asc' }, { userId: 'asc' }] },
          companies: { select: { companyId: true, company: { select: { status: true } } }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }] },
        },
      });
    },
    windowTasks(ids: string[], from: Date, to: Date) {
      return prisma.task.findMany({
        where: { ...KPI_TASK_WHERE, projectId: { in: ids }, createdAt: { lt: to }, OR: [{ completedAt: null }, { completedAt: { gte: from } }] },
        select: taskSelect,
      });
    },
    tasksById(ids: string[]) {
      return prisma.task.findMany({ where: { ...KPI_TASK_WHERE, id: { in: ids } }, select: taskSelect });
    },
    events(taskIds: string[]) {
      return prisma.activity.findMany({
        where: { taskId: { in: taskIds }, action: { in: [...KPI_ACTIONS] } },
        select: { taskId: true, action: true, userId: true, meta: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    },
    doneBefore(ids: string[], before: Date) {
      return prisma.$queryRaw<Array<{ projectId: string; done: unknown; weightDone: unknown }>>`
        SELECT t.projectId AS projectId, COUNT(*) AS done, CAST(SUM(${WEIGHT}) AS SIGNED) AS weightDone
          FROM tasks t JOIN projects p ON p.id = t.projectId
         WHERE t.deletedAt IS NULL AND t.completedAt IS NOT NULL AND t.completedAt < ${before} AND t.createdAt < ${before}
           AND t.projectId IN (${Prisma.join(ids)})
         GROUP BY t.projectId`;
    },
    comments(ids: string[], from: Date, to: Date) {
      return prisma.comment.findMany({
        where: { deletedAt: null, createdAt: { gte: from, lt: to }, task: { ...KPI_TASK_WHERE, projectId: { in: ids } } },
        select: { taskId: true, userId: true, body: true, createdAt: true },
      });
    },
    statusActs(taskIds: string[], from: Date, to: Date) {
      return prisma.activity.findMany({
        where: { taskId: { in: taskIds }, action: { in: [...STATUS_ACTIONS] }, createdAt: { gte: from, lt: to } },
        select: { taskId: true, userId: true, createdAt: true },
      });
    },
    usernames() {
      return prisma.user.findMany({ where: { deletedAt: null, ...STAFF_ONLY_WHERE }, select: { id: true, username: true } });
    },
    closedActionItems(userIds: string[] | null, projectIds: string[] | null, from: Date, to: Date) {
      return prisma.actionItem.findMany({
        where: {
          status: 'COMPLETED',
          completedAt: { gte: from, lt: to },
          assigneeId: userIds ? { in: userIds } : { not: null },
          ...(projectIds ? { projectId: { in: projectIds } } : {}),
        },
        select: { id: true, description: true, assigneeId: true, projectId: true, meetingId: true, completedAt: true },
      });
    },
    blocked(ids: string[]) {
      return prisma.task.findMany({
        where: { ...KPI_TASK_WHERE, projectId: { in: ids }, completedAt: null, approvalRequestedAt: null, column: { category: 'BLOCKED' } },
        select: { id: true, key: true, title: true, projectId: true, updatedAt: true, assignees: { select: { userId: true } } },
      });
    },
    lastMoves(taskIds: string[]) {
      return prisma.activity.groupBy({ by: ['taskId'], where: { taskId: { in: taskIds }, action: { in: MOVES } }, _max: { createdAt: true } });
    },
    meetings(userId: string, from: Date, to: Date) {
      return prisma.meetingAttendee.findMany({
        where: { userId, response: { not: 'DECLINED' }, meeting: { deletedAt: null, status: { not: 'CANCELLED' }, startAt: { gte: from, lt: to } } },
        select: { meeting: { select: { startAt: true, endAt: true } } },
      });
    },
    openTaskCounts(userIds: string[], projectIds: string[] | null) {
      return prisma.taskAssignee.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          task: { ...KPI_TASK_WHERE, completedAt: null, approvalRequestedAt: null, column: { category: { not: 'DONE' } }, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
        },
        _count: { _all: true },
      });
    },
    adminIds() {
      return prisma.user.findMany({ where: { roles: { some: { role: { name: 'ADMIN' } } } }, select: { id: true } });
    },
    people(ids: string[]) {
      return prisma.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } });
    },
  };
}

/** The start-up database check: every statement above, once, about nothing (an id no row has). */
export async function kpiProbe(prisma: PrismaClient, nowhere: string): Promise<void> {
  const r = kpiReads(prisma);
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-02-01T00:00:00.000Z');
  await r.projects([nowhere]);
  await r.windowTasks([nowhere], from, to);
  await r.tasksById([nowhere]);
  await r.events([nowhere]);
  await r.doneBefore([nowhere], to);
  await r.comments([nowhere], from, to);
  await r.statusActs([nowhere], from, to);
  await r.closedActionItems([nowhere], [nowhere], from, to);
  await r.closedActionItems(null, null, from, from);
  await r.blocked([nowhere]);
  await r.lastMoves([nowhere]);
  await r.meetings(nowhere, from, to);
  await r.openTaskCounts([nowhere], [nowhere]);
  await prisma.kpiSnapshot.findFirst({ where: { projectId: nowhere }, select: { id: true } });
  await prisma.kpiTarget.findFirst({ where: { scopeKey: nowhere }, select: { id: true } });
  await prisma.projectKpi.findFirst({ where: { projectId: nowhere }, select: { id: true, values: { select: { month: true }, take: 1 } } });
}

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export function createPrismaKpiSource(prisma: PrismaClient): KpiSource {
  const r = kpiReads(prisma);

  async function withHistory(rows: TaskRow[]): Promise<KpiTask[]> {
    const byTask = new Map<string, HistoryEvent[]>();
    for (const ids of chunks(rows.map((t) => t.id))) {
      for (const e of await r.events(ids)) {
        if (!e.taskId) continue;
        const list = byTask.get(e.taskId) ?? [];
        list.push({ at: e.createdAt, action: e.action, userId: e.userId, meta: e.meta });
        byTask.set(e.taskId, list);
      }
    }
    return rows.map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      projectId: t.projectId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      startDate: t.startDate,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      columnCategory: t.column.category,
      approvalRequestedAt: t.approvalRequestedAt,
      priority: t.priority as KpiPriority,
      weight: t.weight,
      assignees: t.assignees.map((a) => ({ userId: a.userId, assignedAt: a.assignedAt })),
      events: byTask.get(t.id) ?? [],
    }));
  }

  return {
    async projects(ids) {
      const out: KpiProjectRow[] = [];
      for (const part of chunks([...new Set(ids)])) {
        for (const p of await r.projects(part)) {
          out.push({
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
            companyId: p.mainCompanyId ?? p.companies[0]?.companyId ?? null,
            startDate: p.startDate,
            targetDate: p.targetDate,
            completionMode: p.completionMode as CompletionMode,
            weights: weightDefaultsOf(p),
          });
        }
      }
      return out;
    },
    async windowTasks(projectIds, from, to) {
      const rows: TaskRow[] = [];
      for (const part of chunks([...new Set(projectIds)], 100)) rows.push(...(await r.windowTasks(part, from, to)));
      return withHistory(rows);
    },
    async tasksById(ids) {
      const rows: TaskRow[] = [];
      for (const part of chunks([...new Set(ids)])) rows.push(...(await r.tasksById(part)));
      return withHistory(rows);
    },
    async doneBefore(projectIds, before) {
      const out: { projectId: string; done: number; weightDone: number }[] = [];
      for (const part of chunks([...new Set(projectIds)])) for (const x of await r.doneBefore(part, before)) out.push({ projectId: x.projectId, done: num(x.done), weightDone: num(x.weightDone) });
      return out;
    },
    async conversations(projectIds, from, to) {
      const comments = [];
      for (const part of chunks([...new Set(projectIds)], 100)) comments.push(...(await r.comments(part, from, to)));
      if (comments.length === 0) return [];
      const named = comments.some((c) => c.body.includes('@')) ? await r.usernames() : [];
      const byName = new Map(named.map((u) => [u.username.toLowerCase(), u.id]));
      const names = named.map((u) => u.username);
      const items: ConversationItem[] = comments.map((c) => ({
        taskId: c.taskId,
        at: c.createdAt,
        userId: c.userId,
        kind: 'comment' as const,
        mentions: c.body.includes('@') ? matchMentions(c.body, names).map((n) => byName.get(n.toLowerCase())).filter((id): id is string => !!id) : [],
      }));
      const taskIds = [...new Set(comments.map((c) => c.taskId))];
      for (const part of chunks(taskIds)) for (const a of await r.statusActs(part, from, to)) if (a.taskId) items.push({ taskId: a.taskId, at: a.createdAt, userId: a.userId, kind: 'status', mentions: [] });
      return items;
    },
    async closedActionItems(userIds, projectIds, from, to) {
      if ((userIds && userIds.length === 0) || (projectIds && projectIds.length === 0)) return [];
      const rows = await r.closedActionItems(userIds, projectIds, from, to);
      return rows.filter((a) => a.assigneeId && a.completedAt).map((a) => ({ id: a.id, description: a.description, assigneeId: a.assigneeId!, projectId: a.projectId, meetingId: a.meetingId, completedAt: a.completedAt! }));
    },
    async blocked(projectIds) {
      if (projectIds.length === 0) return [];
      const rows = [];
      for (const part of chunks([...new Set(projectIds)])) rows.push(...(await r.blocked(part)));
      const moved = new Map<string, Date>();
      for (const part of chunks(rows.map((t) => t.id))) for (const m of await r.lastMoves(part)) if (m.taskId && m._max.createdAt) moved.set(m.taskId, m._max.createdAt);
      return rows.map((t) => ({ id: t.id, key: t.key, title: t.title, projectId: t.projectId, since: moved.get(t.id) ?? t.updatedAt, assigneeIds: t.assignees.map((a) => a.userId) }));
    },
    async meetings(userId, from, to) {
      return (await r.meetings(userId, from, to)).map((a) => ({ userId, startAt: a.meeting.startAt, endAt: a.meeting.endAt }));
    },
    async openTaskCounts(userIds, projectIds) {
      if (userIds.length === 0 || (projectIds && projectIds.length === 0)) return new Map();
      return new Map((await r.openTaskCounts(userIds, projectIds)).map((g) => [g.userId, g._count._all]));
    },
    async adminIds() {
      return (await r.adminIds()).map((u) => u.id);
    },
    async people(ids): Promise<KpiPerson[]> {
      if (ids.length === 0) return [];
      const out: KpiPerson[] = [];
      for (const part of chunks([...new Set(ids)])) for (const u of await r.people(part)) out.push({ id: u.id, name: nameOf(u), avatarUrl: u.avatarUrl });
      return out;
    },
  };
}
