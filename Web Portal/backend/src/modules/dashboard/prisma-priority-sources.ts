import type { Prisma, PrismaClient } from '@prisma/client';
import { dueDayKey, shiftDayKey, todayKey } from '../../lib/due-date';
import { LIVE_PROJECT_WHERE } from '../companies/company-access';
import { managedVisibleWhere } from '../projects/project-managers';
import type { ApprovalSource } from '../tasks/task-approval-routes';
import type { ActionItemService } from '../meetings/action-item-service';
import { TEAM_OVERDUE_DAYS, UPCOMING_DAYS, type Priority } from './priorities';
import type { PersonName, PrioritySource, PriorityViewer, ProjectBadge, SourcedCandidate, TaskRowData } from './priority-sources';

/**
 * 1.23.4 "My Priorities Today" over the database: the person's own open tasks and the team rows of the
 * projects they run, the approvals waiting for them, and their meeting action items. Prisma only (no raw
 * SQL); every statement is in priorityReads, checked portable to MariaDB by the DB tests
 * (lib/sql-portability) and sent once by the start-up database check (priorityProbe).
 */

const isAdmin = (roles: readonly string[]) => roles.includes('ADMIN');
const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;
const dayStart = (key: string) => new Date(`${key}T00:00:00.000Z`);
const projectSelect = { id: true, code: true, name: true, color: true, icon: true, imageUrl: true } as const;
const personSelect = { id: true, firstName: true, lastName: true, username: true } as const;

/** Open: not deleted, not done, not waiting for approval, in a live project (not deleted or archived). */
const OPEN_TASK: Prisma.TaskWhereInput = {
  deletedAt: null,
  completedAt: null,
  approvalRequestedAt: null,
  column: { category: { not: 'DONE' } },
  project: { is: { deletedAt: null, ...LIVE_PROJECT_WHERE } },
};

const taskSelect = {
  id: true,
  key: true,
  title: true,
  projectId: true,
  columnId: true,
  priority: true,
  startDate: true,
  dueDate: true,
  createdAt: true,
  version: true,
  recurrenceRule: true,
  column: { select: { category: true } },
  project: { select: projectSelect },
  assignees: { select: { user: { select: personSelect } }, orderBy: [{ assignedAt: 'asc' as const }, { userId: 'asc' as const }] },
} satisfies Prisma.TaskSelect;
type TaskPick = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
const depSelect = { id: true, key: true, projectId: true, deletedAt: true, completedAt: true, column: { select: { category: true } }, project: { select: { deletedAt: true } } } as const;

/** What the task source needs to know about the person's reach (wired as the task lists are). */
export interface PriorityTaskScopes {
  /** My Tasks' projects: the pick, never "Show my projects only" (null: every project). */
  ownProjectIds(viewer: PriorityViewer, pick: string | null): Promise<string[] | null>;
  /** A list's projects: the pick and "Show my projects only" (null: every project). */
  listProjectIds(viewer: PriorityViewer, pick: string | null): Promise<string[] | null>;
  /** The projects whose tasks the person may open (an object check; null: every project). */
  openableProjectIds(viewer: PriorityViewer): Promise<string[] | null>;
}

const inScope = (ids: string[] | null): Prisma.TaskWhereInput => (ids ? { projectId: { in: ids } } : {});
/** Loose date edges in the database (a stored instant may sit a day either side of its company day); the ranking decides each row's day exactly. */
const soonEdgeOf = (today: string) => dayStart(shiftDayKey(today, UPCOMING_DAYS + 2));
const lateEdgeOf = (today: string) => dayStart(shiftDayKey(today, -TEAM_OVERDUE_DAYS + 2));

/**
 * Every statement "My Priorities Today" sends, in one place: the sources use them, and the start-up
 * database check sends each once in a harmless form (priorityProbe), so a MariaDB refusal shows there.
 */
export function priorityReads(prisma: PrismaClient) {
  return {
    /** The live projects a non-admin runs (owner, named manager, MANAGER member, in one of their companies), inside `list` (null: anywhere). */
    async managedProjectIds(userId: string, list: string[] | null): Promise<string[]> {
      const rows = await prisma.project.findMany({ where: { AND: [{ deletedAt: null }, managedVisibleWhere(userId), ...(list ? [{ id: { in: list } }] : [])] }, select: { id: true } });
      return rows.map((r) => r.id);
    },
    /** The person's own open tasks that may have a reason: due before `soonEdge`, urgent, Blocked, or with a dependency either way. */
    mineTasks(userId: string, own: string[] | null, soonEdge: Date): Promise<TaskPick[]> {
      return prisma.task.findMany({
        where: {
          AND: [
            OPEN_TASK,
            inScope(own),
            { assignees: { some: { userId } } },
            { OR: [{ dueDate: { lt: soonEdge } }, { priority: 'URGENT' }, { column: { category: 'BLOCKED' } }, { dependencies: { some: {} } }, { dependedOnBy: { some: {} } }] },
          ],
        },
        select: taskSelect,
      });
    },
    /** Open tasks in `team` that aren't the person's and have no one assigned, sit in a Blocked column, or are due before `lateEdge`. */
    teamTasks(userId: string, team: string[] | null, lateEdge: Date): Promise<TaskPick[]> {
      return prisma.task.findMany({
        where: { AND: [OPEN_TASK, inScope(team), { assignees: { none: { userId } } }, { OR: [{ assignees: { none: {} } }, { column: { category: 'BLOCKED' } }, { dueDate: { lt: lateEdge } }] }] },
        select: taskSelect,
      });
    },
    /** The dependencies of these tasks either way, with the other task's state. */
    edges(taskIds: string[]) {
      return prisma.taskDependency.findMany({
        where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }] },
        select: { taskId: true, dependsOnTaskId: true, task: { select: depSelect }, dependsOn: { select: depSelect } },
      });
    },
    /** These projects' Done columns, in board order. */
    doneColumns(projectIds: string[]) {
      return prisma.kanbanColumn.findMany({ where: { projectId: { in: projectIds }, category: 'DONE' }, select: { id: true, projectId: true, enabled: true, position: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    },
    /** Which of these projects are live (not deleted, not archived). */
    async liveProjectIds(projectIds: string[]): Promise<Set<string>> {
      if (projectIds.length === 0) return new Set();
      return new Set((await prisma.project.findMany({ where: { id: { in: projectIds }, deletedAt: null, ...LIVE_PROJECT_WHERE }, select: { id: true } })).map((p) => p.id));
    },
    /** These meetings (not deleted): their titles and projects. */
    meetings(meetingIds: string[]) {
      return prisma.meeting.findMany({ where: { id: { in: meetingIds }, deletedAt: null }, select: { id: true, title: true, projectId: true } });
    },
  };
}

/** The start-up database check: every statement above, once, one after another, about nothing (an id no row has). */
export async function priorityProbe(prisma: PrismaClient, nowhere: string, timeZone: string): Promise<void> {
  const reads = priorityReads(prisma);
  const today = todayKey(timeZone);
  await reads.managedProjectIds(nowhere, [nowhere]);
  await reads.mineTasks(nowhere, [nowhere], soonEdgeOf(today));
  await reads.teamTasks(nowhere, [nowhere], lateEdgeOf(today));
  await reads.edges([nowhere]);
  await reads.doneColumns([nowhere]);
  await reads.liveProjectIds([nowhere]);
  await reads.meetings([nowhere]);
}

/**
 * The person's own open tasks with a reason (a date up to 3 days ahead, urgent, a Blocked column, a
 * dependency either way) and, for the people who run projects, the open tasks there that are not theirs and
 * have no one assigned, sit in a Blocked column or are 3+ days late. Each with its open blockers and how many
 * open tasks wait on it — only tasks the person may open count (a hidden one counts for nothing).
 */
export function createPrismaTaskPrioritySource(prisma: PrismaClient, scopes: PriorityTaskScopes): PrioritySource {
  const reads = priorityReads(prisma);
  /** Whose other people's tasks the person watches: the projects they run in the list scope; an administrator's whole list scope. */
  async function teamProjectIds(viewer: PriorityViewer, pick: string | null): Promise<string[] | null> {
    const list = await scopes.listProjectIds(viewer, pick);
    if (isAdmin(viewer.roles)) return list;
    if (list && list.length === 0) return [];
    return reads.managedProjectIds(viewer.id, list);
  }

  return {
    name: 'tasks',
    async collect({ viewer, pick, today, timeZone }) {
      const me = viewer.id;
      const [own, team, openable] = await Promise.all([scopes.ownProjectIds(viewer, pick), teamProjectIds(viewer, pick), scopes.openableProjectIds(viewer)]);
      const [mineRows, teamRows] = await Promise.all([
        own && own.length === 0 ? Promise.resolve([] as TaskPick[]) : reads.mineTasks(me, own, soonEdgeOf(today)),
        team && team.length === 0 ? Promise.resolve([] as TaskPick[]) : reads.teamTasks(me, team, lateEdgeOf(today)),
      ]);
      const rows = [...mineRows.map((t) => ({ t, mine: true })), ...teamRows.map((t) => ({ t, mine: false }))];
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.t.id);
      const projectIds = [...new Set(rows.map((r) => r.t.projectId))];
      const openableSet = openable ? new Set(openable) : null;
      const mayOpen = (projectId: string) => openableSet === null || openableSet.has(projectId);

      // Dependencies either way, with the other task's state; the Done columns a Complete moves to.
      const [edges, doneColumns] = await Promise.all([reads.edges(ids), reads.doneColumns(projectIds)]);
      type Other = (typeof edges)[number]['task'];
      const isOpenVisible = (o: Other) => !o.deletedAt && !o.completedAt && o.column.category !== 'DONE' && !o.project.deletedAt && mayOpen(o.projectId);
      const blockers = new Map<string, { id: string; key: string; projectId: string }[]>();
      const dependents = new Map<string, number>();
      const wanted = new Set(ids);
      for (const e of edges) {
        if (wanted.has(e.taskId) && isOpenVisible(e.dependsOn)) {
          const list = blockers.get(e.taskId) ?? [];
          list.push({ id: e.dependsOn.id, key: e.dependsOn.key, projectId: e.dependsOn.projectId });
          blockers.set(e.taskId, list);
        }
        if (wanted.has(e.dependsOnTaskId) && isOpenVisible(e.task)) dependents.set(e.dependsOnTaskId, (dependents.get(e.dependsOnTaskId) ?? 0) + 1);
      }
      // A Complete goes to the project's first enabled Done column (else its first Done column), as My Tasks' Complete.
      const doneOf = new Map<string, string>();
      for (const c of doneColumns) if (c.enabled && !doneOf.has(c.projectId)) doneOf.set(c.projectId, c.id);
      for (const c of doneColumns) if (!doneOf.has(c.projectId)) doneOf.set(c.projectId, c.id);

      const out: SourcedCandidate[] = [];
      const seen = new Set<string>();
      for (const { t, mine } of rows) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const blocked = (blockers.get(t.id) ?? []).sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
        const assignees = t.assignees.map((a) => ({ id: a.user.id, name: nameOf(a.user) }));
        const row = taskRow(t, timeZone, { assignees, blockers: blocked.map(({ id, key }) => ({ id, key })), doneColumnId: doneOf.get(t.projectId) ?? null });
        out.push({
          kind: 'task',
          id: t.id,
          key: t.key,
          priority: t.priority as Priority,
          dueDate: t.dueDate,
          createdAt: t.createdAt,
          columnCategory: t.column.category,
          assigneeIds: assignees.map((a) => a.id),
          mine,
          team: !mine,
          blockers: row.blockers,
          dependents: dependents.get(t.id) ?? 0,
          row: { task: row },
          watch: [t.projectId, ...blocked.map((b) => b.projectId)],
        });
      }
      return out;
    },
  };
}

/**
 * A task as its row shows it. Complete needs the project's Done column; a task waiting on another (open)
 * task offers Open and Reschedule only (design call 2: no Complete, no Assign).
 */
function taskRow(
  t: { id: string; key: string; title: string; priority: string; dueDate: Date | null; startDate: Date | null; version: number; columnId: string; recurrenceRule: unknown; project: ProjectBadge },
  timeZone: string,
  extra: { assignees: PersonName[]; blockers: { id: string; key: string }[]; doneColumnId: string | null },
): TaskRowData {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    priority: t.priority as Priority,
    dueDate: dueDayKey(t.dueDate, timeZone),
    startDate: dueDayKey(t.startDate, timeZone),
    startAt: t.startDate ? t.startDate.toISOString() : null,
    version: t.version,
    columnId: t.columnId,
    project: { id: t.project.id, code: t.project.code, name: t.project.name, color: t.project.color, icon: t.project.icon, imageUrl: t.project.imageUrl },
    assignees: extra.assignees,
    blockers: extra.blockers,
    doneColumnId: extra.doneColumnId,
    recurrenceRule: t.recurrenceRule ?? null,
    can: { complete: extra.doneColumnId !== null && extra.blockers.length === 0, reschedule: true, assign: extra.blockers.length === 0, approve: false },
  };
}

/**
 * The tasks waiting for the person's approval, as the To approve list (and the Dashboard's card) has them:
 * every one they may approve, in the picked company — an administrator's also following "Show my projects
 * only" — and not in an archived project (Approve is refused there).
 */
export function createApprovalPrioritySource(deps: {
  prisma: PrismaClient;
  approvals: Pick<ApprovalSource, 'list'>;
  listProjectIds: (viewer: PriorityViewer, pick: string | null) => Promise<string[] | null>;
}): PrioritySource {
  const reads = priorityReads(deps.prisma);
  return {
    name: 'approvals',
    async collect({ viewer, pick, timeZone }) {
      const rows = await deps.approvals.list(viewer);
      if (rows.length === 0) return [];
      const picked = pick || isAdmin(viewer.roles) ? await deps.listProjectIds(viewer, pick) : null;
      const inPick = picked ? new Set(picked) : null;
      const kept = inPick ? rows.filter((r) => inPick.has(r.projectId)) : rows;
      if (kept.length === 0) return [];
      const live = await reads.liveProjectIds([...new Set(kept.map((r) => r.projectId))]);
      return kept
        .filter((r) => live.has(r.projectId))
        .map((r): SourcedCandidate => {
          const row = taskRow(r, timeZone, { assignees: r.assignees ?? [], blockers: [], doneColumnId: null });
          return {
            kind: 'approval',
            id: r.id,
            key: r.key,
            priority: r.priority as Priority,
            dueDate: r.dueDate,
            createdAt: r.createdAt,
            requestedAt: r.approvalRequestedAt ?? null,
            row: {
              task: {
                ...row,
                can: { complete: false, reschedule: false, assign: false, approve: true },
                requestedBy: r.requestedBy,
                requestedAt: r.approvalRequestedAt ? r.approvalRequestedAt.toISOString() : null,
              },
            },
            watch: [r.projectId],
          };
        });
    },
  };
}

/**
 * The person's own open meeting action items with a due date (My Action Items' scope: the picked company,
 * never "Show my projects only"), each naming its meeting only when the person may open it. Items of an
 * archived project are left out (Mark done is refused there).
 */
export function createActionItemPrioritySource(deps: {
  prisma: PrismaClient;
  actionItems: Pick<ActionItemService, 'listMine'>;
  /** May the person open this meeting's page (the full or the invitee view)? */
  canOpenMeeting: (viewer: PriorityViewer, meetingId: string) => Promise<boolean>;
}): PrioritySource {
  const reads = priorityReads(deps.prisma);
  return {
    name: 'action-items',
    async collect({ viewer, pick, today, timeZone }) {
      // Only items with a date reason (late, today, the next 3 days): nothing is looked up for the rest (review I5).
      const last = shiftDayKey(today, UPCOMING_DAYS);
      const items = (await deps.actionItems.listMine(viewer.id, { openOnly: true, ...(pick ? { pick: { companyId: pick } } : {}), admin: isAdmin(viewer.roles) })).filter((a) => {
        const day = dueDayKey(a.dueDate, timeZone);
        return day !== null && day <= last;
      });
      if (items.length === 0) return [];
      const meetingIds = [...new Set(items.map((a) => a.meetingId).filter((id): id is string => !!id))];
      const meetings = meetingIds.length ? await reads.meetings(meetingIds) : [];
      const meetingOf = new Map(meetings.map((m) => [m.id, m]));
      const projectOf = (a: (typeof items)[number]) => a.projectId ?? (a.meetingId ? (meetingOf.get(a.meetingId)?.projectId ?? null) : null);
      const live = await reads.liveProjectIds([...new Set(items.map(projectOf).filter((id): id is string => !!id))]);
      const seen = await Promise.all(meetings.map((m) => deps.canOpenMeeting(viewer, m.id).catch(() => false)));
      const openable = new Set(meetings.filter((_, i) => seen[i]).map((m) => m.id));
      const out: SourcedCandidate[] = [];
      for (const a of items) {
        const projectId = projectOf(a);
        if (projectId && !live.has(projectId)) continue;
        const meeting = a.meetingId && openable.has(a.meetingId) ? meetingOf.get(a.meetingId)! : null;
        out.push({
          kind: 'action-item',
          id: a.id,
          key: null,
          priority: a.priority as Priority,
          dueDate: a.dueDate,
          createdAt: a.createdAt,
          linkedTaskId: a.taskId,
          row: {
            actionItem: {
              id: a.id,
              description: a.description,
              dueDate: dueDayKey(a.dueDate, timeZone),
              priority: a.priority as Priority,
              status: a.status,
              meeting: meeting ? { id: meeting.id, title: meeting.title } : null,
              projectId,
              can: { done: true, reschedule: true },
            },
          },
          watch: projectId ? [projectId] : [],
        });
      }
      return out;
    },
  };
}
