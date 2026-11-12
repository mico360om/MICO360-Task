import { Prisma, type PrismaClient } from '@prisma/client';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import type { ProjectStatus } from '../management/management-rules';
import { weightDefaultsOf, type CompletionMode } from '../project-health/completion';
import { matchMentions } from '../tasks/mentions';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';
import { KPI_OPEN_TASK_WHERE, KPI_TASK_WHERE } from './kpi-task-scope';
import { dueDayKey } from '../../lib/due-date';
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
export const KPI_ACTIONS = ['CREATED', 'UPDATED', 'ASSIGNED', 'UNASSIGNED', 'APPROVAL_REQUESTED', 'APPROVED', 'SENT_BACK', 'APPROVAL_WITHDRAWN', 'COMPLETED', 'REOPENED', 'MOVED'] as const;
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
  // The task archive (Release B): an archived Done task still counts, an archived open one leaves the figures.
  archivedAt: true,
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
    windowTasks(ids: string[], from: Date, to: Date, onlyIds?: string[]) {
      return prisma.task.findMany({
        where: { ...KPI_TASK_WHERE, projectId: { in: ids }, ...(onlyIds ? { id: { in: onlyIds } } : {}), createdAt: { lt: to }, OR: [{ completedAt: null }, { completedAt: { gte: from } }] },
        select: taskSelect,
      });
    },
    /** A person's tasks in these projects: on them now, or named in their ASSIGNED / UNASSIGNED lines. */
    assignedNow(userId: string, ids: string[]) {
      return prisma.taskAssignee.findMany({ where: { userId, task: { ...KPI_TASK_WHERE, projectId: { in: ids } } }, select: { taskId: true } });
    },
    assignmentLines(ids: string[]) {
      return prisma.activity.findMany({ where: { projectId: { in: ids }, action: { in: ['ASSIGNED', 'UNASSIGNED'] }, taskId: { not: null } }, select: { taskId: true, meta: true } });
    },
    decided(userId: string, ids: string[], from: Date) {
      return prisma.activity.findMany({ where: { userId, projectId: { in: ids }, action: { in: ['APPROVED', 'SENT_BACK', 'COMPLETED'] }, createdAt: { gte: from }, taskId: { not: null } }, select: { taskId: true } });
    },
    /** Merges into these tasks (not undone): the lines and people they moved over, and what they changed. */
    merges(taskIds: string[]) {
      return prisma.taskMerge.findMany({
        where: { mainTaskId: { in: taskIds }, undoneAt: null },
        select: { mainTaskId: true, mergedAt: true, mergedById: true, changes: true, items: { where: { kind: { in: ['activity', 'assignee'] } }, select: { kind: true, rowId: true } } },
      });
    },
    /**
     * Owner, 11 Nov — late stays counted: tasks of these projects sent to the Recycle Bin or merged since
     * `from` (a merge sets deletedAt too). Recycle Bin lane: once merged, its deletedById / binExpiresAt don't
     * change this — a task erased for good after 60 days is gone (its month's snapshot keeps the mark).
     */
    removedTasks(ids: string[], from: Date, to: Date) {
      return prisma.task.findMany({
        where: { projectId: { in: ids }, deletedAt: { gte: from }, createdAt: { lt: to } },
        select: { ...taskSelect, deletedAt: true, mergedAt: true, mergedIntoId: true },
      });
    },
    /** What merges moved off these merged tasks onto their main task (merges not undone): lines and people. */
    movedOff(taskIds: string[]) {
      return prisma.taskMergeItem.findMany({
        where: { fromTaskId: { in: taskIds }, kind: { in: ['activity', 'assignee'] }, merge: { undoneAt: null } },
        select: { kind: true, rowId: true, fromTaskId: true, merge: { select: { mainTaskId: true } } },
      });
    },
    linesById(ids: string[]) {
      return prisma.activity.findMany({
        where: { id: { in: ids }, action: { in: [...KPI_ACTIONS] } },
        select: { id: true, taskId: true, action: true, userId: true, meta: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    },
    assigneeRows(pairs: { taskId: string; userId: string }[]) {
      return prisma.taskAssignee.findMany({ where: { OR: pairs }, select: { taskId: true, userId: true, assignedAt: true } });
    },
    tasksById(ids: string[]) {
      return prisma.task.findMany({ where: { ...KPI_TASK_WHERE, id: { in: ids } }, select: taskSelect });
    },
    events(taskIds: string[]) {
      return prisma.activity.findMany({
        where: { taskId: { in: taskIds }, action: { in: [...KPI_ACTIONS] } },
        select: { id: true, taskId: true, action: true, userId: true, meta: true, createdAt: true },
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
        where: { ...KPI_OPEN_TASK_WHERE, projectId: { in: ids }, completedAt: null, approvalRequestedAt: null, column: { category: 'BLOCKED' } },
        select: { id: true, key: true, title: true, projectId: true, updatedAt: true, assignees: { select: { userId: true } } },
      });
    },
    lastMoves(taskIds: string[]) {
      return prisma.activity.groupBy({ by: ['taskId'], where: { taskId: { in: taskIds }, action: { in: MOVES } }, _max: { createdAt: true } });
    },
    meetings(userId: string, from: Date, to: Date, projectIds?: string[]) {
      return prisma.meetingAttendee.findMany({
        where: { userId, response: { not: 'DECLINED' }, meeting: { deletedAt: null, status: { not: 'CANCELLED' }, startAt: { gte: from, lt: to }, ...(projectIds ? { projectId: { in: projectIds } } : {}) } },
        select: { meeting: { select: { startAt: true, endAt: true } } },
      });
    },
    openTaskCounts(userIds: string[], projectIds: string[] | null) {
      return prisma.taskAssignee.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          task: { ...KPI_OPEN_TASK_WHERE, completedAt: null, approvalRequestedAt: null, column: { category: { not: 'DONE' } }, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
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
  await r.windowTasks([nowhere], from, to, [nowhere]);
  await r.assignedNow(nowhere, [nowhere]);
  await r.assignmentLines([nowhere]);
  await r.decided(nowhere, [nowhere], from);
  await r.merges([nowhere]);
  await r.tasksById([nowhere]);
  await r.removedTasks([nowhere], from, to);
  await r.movedOff([nowhere]);
  await r.linesById([nowhere]);
  await r.assigneeRows([{ taskId: nowhere, userId: nowhere }]);
  await r.events([nowhere]);
  await r.doneBefore([nowhere], to);
  await r.comments([nowhere], from, to);
  await r.statusActs([nowhere], from, to);
  await r.closedActionItems([nowhere], [nowhere], from, to);
  await r.closedActionItems(null, null, from, from);
  await r.blocked([nowhere]);
  await r.lastMoves([nowhere]);
  await r.meetings(nowhere, from, to);
  await r.meetings(nowhere, from, to, [nowhere]);
  await r.openTaskCounts([nowhere], [nowhere]);
  await prisma.kpiSnapshot.findFirst({ where: { projectId: nowhere }, select: { id: true } });
  await prisma.kpiTarget.findFirst({ where: { scopeKey: nowhere }, select: { id: true } });
  await prisma.projectKpi.findFirst({ where: { projectId: nowhere }, select: { id: true, values: { select: { month: true }, take: 1 } } });
}

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export function createPrismaKpiSource(prisma: PrismaClient, timeZone = 'Asia/Muscat'): KpiSource {
  const r = kpiReads(prisma);

  async function withHistory(rows: TaskRow[]): Promise<KpiTask[]> {
    const byTask = new Map<string, HistoryEvent[]>();
    // Review I4: a merge moved the merged tasks' lines and people onto the main task — they are not the
    // main task's own history: its lines are left out, its people start at the merge, and the due date
    // the merge chose is a change by whoever merged, at that moment.
    const movedLines = new Set<string>();
    const joinedAt = new Map<string, Map<string, Date>>();
    const merged = new Map<string, HistoryEvent[]>();
    for (const ids of chunks(rows.map((t) => t.id))) {
      for (const m of await r.merges(ids)) {
        for (const it of m.items) {
          if (it.kind === 'activity') movedLines.add(it.rowId);
          else {
            const people = joinedAt.get(m.mainTaskId) ?? new Map<string, Date>();
            people.set(it.rowId, m.mergedAt);
            joinedAt.set(m.mainTaskId, people);
          }
        }
        const due = (m.changes as Record<string, { before?: unknown; after?: unknown } | undefined> | null)?.dueDate;
        if (due) {
          const day = (v: unknown) => (v === null || v === undefined ? null : dueDayKey(v as string, timeZone));
          merged.set(m.mainTaskId, [...(merged.get(m.mainTaskId) ?? []), { at: m.mergedAt, action: 'UPDATED', userId: m.mergedById, meta: { changes: [{ field: 'dueDate', from: day(due.before), to: day(due.after) }] } }]);
        }
      }
      for (const e of await r.events(ids)) {
        if (!e.taskId || movedLines.has(e.id)) continue;
        const list = byTask.get(e.taskId) ?? [];
        list.push({ at: e.createdAt, action: e.action, userId: e.userId, meta: e.meta });
        byTask.set(e.taskId, list);
      }
    }
    for (const [taskId, extra] of merged) byTask.set(taskId, [...(byTask.get(taskId) ?? []), ...extra].sort((a, b) => a.at.getTime() - b.at.getTime()));
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
      archivedAt: t.archivedAt,
      assignees: t.assignees.map((a) => {
        const joined = joinedAt.get(t.id)?.get(a.userId);
        return { userId: a.userId, assignedAt: joined && joined > a.assignedAt ? joined : a.assignedAt };
      }),
      events: byTask.get(t.id) ?? [],
    }));
  }

  /**
   * Tasks binned or merged since `from`, with their history. A merged task's own lines and people were moved to
   * its main task (task_merge_items): they are read back from there, so it is judged as it stood.
   */
  async function removedSince(projectIds: string[], from: Date, to: Date): Promise<KpiTask[]> {
    if (projectIds.length === 0) return [];
    const rows: (TaskRow & { deletedAt: Date | null; mergedAt: Date | null; mergedIntoId: string | null })[] = [];
    for (const part of chunks(projectIds, 100)) rows.push(...(await r.removedTasks(part, from, to)));
    if (rows.length === 0) return [];
    const own = await withHistory(rows);
    const merged = rows.filter((t) => t.mergedIntoId).map((t) => t.id);
    const lines = new Map<string, HistoryEvent[]>();
    const people = new Map<string, { userId: string; assignedAt: Date }[]>();
    for (const part of chunks(merged)) {
      const items = await r.movedOff(part);
      const lineOf = new Map(items.filter((i) => i.kind === 'activity').map((i) => [i.rowId, i.fromTaskId]));
      for (const ids of chunks([...lineOf.keys()])) {
        for (const e of await r.linesById(ids)) {
          const t = lineOf.get(e.id)!;
          lines.set(t, [...(lines.get(t) ?? []), { at: e.createdAt, action: e.action, userId: e.userId, meta: e.meta }]);
        }
      }
      const moved = items.filter((i) => i.kind === 'assignee').map((i) => ({ taskId: i.merge.mainTaskId, userId: i.rowId, from: i.fromTaskId }));
      if (moved.length) {
        const found = await r.assigneeRows(moved.map((m) => ({ taskId: m.taskId, userId: m.userId })));
        for (const m of moved) {
          const row = found.find((f) => f.taskId === m.taskId && f.userId === m.userId);
          if (row) people.set(m.from, [...(people.get(m.from) ?? []), { userId: m.userId, assignedAt: row.assignedAt }]);
        }
      }
    }
    return own.map((t) => {
      const row = rows.find((x) => x.id === t.id)!;
      const how = row.mergedIntoId ? 'merged' : 'binned';
      const extra = lines.get(t.id) ?? [];
      return {
        ...t,
        removedAt: (how === 'merged' ? row.mergedAt : null) ?? row.deletedAt,
        removedHow: how,
        assignees: [...t.assignees, ...(people.get(t.id) ?? []).filter((p) => !t.assignees.some((a) => a.userId === p.userId))],
        events: extra.length ? [...t.events, ...extra].sort((a, b) => a.at.getTime() - b.at.getTime()) : t.events,
      };
    });
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
    async windowTasks(projectIds, from, to, opts) {
      const rows: TaskRow[] = [];
      if (opts?.onlyIds) {
        for (const part of chunks([...new Set(opts.onlyIds)])) rows.push(...(await r.windowTasks([...new Set(projectIds)], from, to, part)));
      } else for (const part of chunks([...new Set(projectIds)], 100)) rows.push(...(await r.windowTasks(part, from, to)));
      // Owner, 11 Nov — late stays counted: the tasks binned or merged since `from` (few; never filtered to
      // one person here — a merged task's people were moved to its main task).
      return [...(await withHistory(rows)), ...(await removedSince([...new Set(projectIds)], from, to))];
    },
    async personTaskIds(userId, projectIds, from) {
      if (projectIds.length === 0) return [];
      const out = new Set<string>();
      for (const part of chunks([...new Set(projectIds)], 100)) {
        for (const a of await r.assignedNow(userId, part)) out.add(a.taskId);
        for (const l of await r.assignmentLines(part)) if (l.taskId && (l.meta as { assigneeId?: unknown } | null)?.assigneeId === userId) out.add(l.taskId);
        for (const d of await r.decided(userId, part, from)) if (d.taskId) out.add(d.taskId);
      }
      return [...out];
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
    async meetings(userId, from, to, projectIds) {
      if (projectIds && projectIds.length === 0) return [];
      return (await r.meetings(userId, from, to, projectIds)).map((a) => ({ userId, startAt: a.meeting.startAt, endAt: a.meeting.endAt }));
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
