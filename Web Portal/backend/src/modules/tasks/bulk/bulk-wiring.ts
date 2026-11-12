import type { Prisma, PrismaClient } from '@prisma/client';
import { dueDayKey } from '../../../lib/due-date';
import { liveTaskWhere } from '../prisma-task-repository';
import { isAwaitingApproval } from '../task-approval';
import { mayDeleteTask, DELETE_NOT_ALLOWED } from '../task-delete-rule';
import { binExpiryOf } from '../../recycle-bin/bin-rules';
import { collectNotices, combineNotices } from '../../notifications/notice-batch';
import type { CreateNotificationData } from '../../notifications/notification-repository';
import type { TaskService } from '../task-service';
import type { AssigneeService } from '../assignee-service';
import type { CategoryService } from '../../categories/category-service';
import type { GuestService } from '../../guests/guest-service';
import type { MoveResult, TaskMoveService } from '../task-move-service';
import type { TaskDuplicateService } from '../task-duplicate';
import type { TaskArchiveService } from '../task-archive';
import type { BinService } from '../../recycle-bin/bin-service';
import type { BulkActor, BulkPriority, BulkRecord, BulkTask, TaskBulkPorts, UndoEntry } from './task-bulk';

/** What the bulk change service is wired to: the single-task services, so each task keeps their rules. */
export interface BulkWiringDeps {
  prisma: PrismaClient;
  timeZone: string;
  taskService: TaskService;
  assigneeService: AssigneeService;
  categoryService: CategoryService;
  guestService: GuestService;
  taskMoveService: TaskMoveService;
  taskDuplicateService: TaskDuplicateService;
  taskArchiveService: TaskArchiveService;
  binService: BinService;
  canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** The projects whose tasks this person may open (null: every one — an administrator). */
  accessibleProjectIds(userId: string, roles: string[]): Promise<string[] | null>;
  /** Has this person muted this type of notice (a combined notice leaves muted ones out first)? */
  isMuted?(userId: string, type: string): Promise<boolean>;
  /** Administrators and the people who run the project (approvals, the delete rule's first half). */
  canManageProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  isProjectArchived(projectId: string): Promise<boolean>;
  notify(n: CreateNotificationData): Promise<unknown>;
  audit?(entry: { userId: string | null; module: string; action: string; entityId: string | null; newValue: Record<string, unknown>; ip?: string | null }): Promise<unknown>;
  broadcast?(projectId: string, event: string, payload: unknown): void;
  /** After a move (as the move route does): its audit lines (people put on a team, a task off a client page). */
  afterMove?(actorId: string, move: MoveResult): Promise<void>;
  /** Search and other views re-read a task (the copies erased, …). */
  taskChanged?(taskId: string): Promise<void>;
  onError?(err: unknown, what: string): void;
}

const displayName = (u: { username: string; firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

export function createBulkPorts(deps: BulkWiringDeps): Omit<TaskBulkPorts, 'now'> {
  const { prisma, timeZone } = deps;
  const day = (d: Date | null) => (d ? dueDayKey(d, timeZone) : null);
  const onDay = (key: string | null) => (key ? new Date(`${key}T00:00:00.000Z`) : null);
  const viewer = (a: BulkActor) => ({ id: a.id, roles: a.roles });

  return {
    async load(ids): Promise<BulkTask[]> {
      if (ids.length === 0) return [];
      const rows = await prisma.task.findMany({
        where: { id: { in: ids }, ...liveTaskWhere },
        select: {
          id: true, key: true, title: true, projectId: true, columnId: true, completedAt: true, priority: true, dueDate: true, startDate: true,
          needsApproval: true, approvalRequestedAt: true, approvalRequestedById: true, archivedAt: true, archivedById: true, isMilestone: true,
          column: { select: { category: true } },
          assignees: { select: { userId: true }, orderBy: { assignedAt: 'asc' } },
          externalContacts: { select: { guestId: true } },
          categories: { select: { categoryId: true } },
        },
      });
      return rows.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        projectId: t.projectId,
        columnId: t.columnId,
        columnCategory: t.column?.category ?? null,
        completedAt: t.completedAt,
        priority: t.priority as BulkPriority,
        dueDay: day(t.dueDate),
        startDay: day(t.startDate),
        needsApproval: t.needsApproval,
        approvalRequestedAt: t.approvalRequestedAt,
        approvalRequestedById: t.approvalRequestedById,
        archivedAt: t.archivedAt,
        archivedById: t.archivedById,
        assigneeIds: t.assignees.map((a) => a.userId),
        guestIds: t.externalContacts.map((c) => c.guestId).filter((g): g is string => !!g),
        categoryIds: t.categories.map((c) => c.categoryId),
        isMilestone: t.isMilestone,
      }));
    },
    canViewProject: (a, p) => deps.canViewProject(a.id, a.roles, p),
    async projectName(p) {
      return (await prisma.project.findUnique({ where: { id: p }, select: { name: true } }))?.name ?? 'This project';
    },
    isProjectArchived: (p) => deps.isProjectArchived(p),
    columnsOf: (p) => prisma.kanbanColumn.findMany({ where: { projectId: p }, select: { id: true, name: true, category: true, position: true, enabled: true } }),
    canApprove: (a, p) => deps.canManageProject(a.id, a.roles, p),
    assignableIn: (p, ids) => deps.assigneeService.eligibleAssignees(p, ids),
    async namesOf(actor, ids) {
      // Review M1: only people the person may know — on the team of a project they can open, or an
      // administrator (anyone else stays "Someone" in a reason).
      if (ids.length === 0) return new Map();
      const scope = await deps.accessibleProjectIds(actor.id, actor.roles);
      let known = new Set(ids);
      if (scope !== null) {
        const projects = scope.length ? await prisma.project.findMany({ where: { id: { in: scope } }, select: { ownerId: true, managerId: true, members: { where: { userId: { in: ids } }, select: { userId: true } } } }) : [];
        const admins = await prisma.userRole.findMany({ where: { userId: { in: ids }, role: { name: 'ADMIN' } }, select: { userId: true } });
        known = new Set([...projects.flatMap((p) => [p.ownerId, p.managerId, ...p.members.map((m) => m.userId)]), ...admins.map((a) => a.userId)].filter((x): x is string => !!x));
      }
      const users = await prisma.user.findMany({ where: { id: { in: ids.filter((id) => known.has(id)) } }, select: { id: true, username: true, firstName: true, lastName: true } });
      return new Map(users.map((u) => [u.id, displayName(u)]));
    },
    async categoriesOf(p) {
      const { requireCategory, categories } = await deps.categoryService.list(p);
      return { requireCategory, categories: categories.map((c) => ({ id: c.id, name: c.name, retired: Boolean(c.retired) })) };
    },
    async guestsFor(actor, p, ids) {
      // The part of the company's list this person may pick from (another company's people on a shared project: its guests only).
      const listed = await deps.guestService.listForProject(p, '', 100_000, viewer(actor));
      return new Map(listed.filter((g) => ids.includes(g.id)).map((g) => [g.id, g.name]));
    },

    async moveToColumn(a, taskId, columnId) {
      const after = await deps.taskService.moveTask(taskId, columnId, undefined, a.id);
      return { columnId: after.columnId, waits: isAwaitingApproval(after) };
    },
    async withdrawApproval(a, taskId) {
      await deps.taskService.withdrawApproval(taskId, a.id);
    },
    async setPriority(a, taskId, priority) {
      await deps.taskService.updateTask(taskId, { priority }, undefined, 'one', a.id);
    },
    async setDueDay(a, taskId, key) {
      await deps.taskService.updateTask(taskId, { dueDate: onDay(key) }, undefined, 'one', a.id);
    },
    async addPeople(a, taskId, ids) {
      await deps.assigneeService.assignUsers(taskId, ids, a.id);
    },
    async removePerson(a, taskId, userId) {
      await deps.assigneeService.unassignUser(taskId, userId, a.id);
    },
    async setCategories(a, taskId, ids) {
      await deps.categoryService.setForTask(taskId, ids, a.id);
    },
    async addGuest(a, taskId, guestId) {
      await deps.guestService.addToTask(taskId, guestId, undefined, a.id);
    },
    async removeGuest(a, taskId, guestId) {
      await deps.guestService.removeFromTask(taskId, guestId, a.id);
    },
    move: {
      preview: (a, ids, projectId) => deps.taskMoveService.preview(a, ids, projectId),
      async move(a, ids, input) {
        const result = await deps.taskMoveService.moveTasks(a, ids, input);
        for (const r of result.results) if (r.ok) await deps.afterMove?.(a.id, r).catch((err: unknown) => deps.onError?.(err, 'after a bulk move'));
        return {
          results: result.results.map((r) => (r.ok ? { taskId: r.taskId, ok: true as const, task: { key: r.task.key, projectId: r.task.projectId } } : { taskId: r.taskId, ok: false as const, error: r.error })),
        };
      },
      async moveBack(a, taskId, to) {
        // Never widens a team on Undo: anyone not on the old team is taken off (they came from there).
        const move = await deps.taskMoveService.moveTask(a, taskId, { projectId: to.projectId, columnId: to.columnId, assignees: 'UNASSIGN', reclaimKey: to.key });
        await deps.afterMove?.(a.id, move).catch((err: unknown) => deps.onError?.(err, 'after a bulk move put back'));
      },
    },
    async duplicate(a, taskId) {
      const { task } = await deps.taskDuplicateService.duplicate(a, taskId, { markCopy: true });
      return { id: task.id, key: task.key };
    },
    async eraseCopy(a, copyId) {
      // Undo of a Duplicate (call 3): only a copy this person made, still there — erased at once, never the bin.
      // Review C1: never a copy other tasks were merged into since (erasing it would erase them too): it is
      // taken in one transaction, its row locked, so a merge can't slip in between (the merge locks its tasks).
      const at = new Date();
      const taken = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tasks WHERE id = ${copyId} AND createdById = ${a.id} AND duplicatedFromId IS NOT NULL AND deletedAt IS NULL FOR UPDATE`;
        if (locked.length !== 1) return false;
        if ((await tx.task.count({ where: { mergedIntoId: copyId } })) > 0) return false;
        if ((await tx.taskMerge.count({ where: { mainTaskId: copyId } })) > 0) return false;
        const { count } = await tx.task.updateMany({ where: { id: copyId, deletedAt: null }, data: { deletedAt: at, deletedById: a.id, binExpiresAt: binExpiryOf(at, timeZone) } });
        return count === 1;
      });
      if (!taken) return false;
      const t = await prisma.task.findUnique({ where: { id: copyId }, select: { projectId: true } });
      // Review I2: through the bin's own erase — its copied files go too (when nothing else uses them), with
      // the audit line saying why. Should erasing fail, it stays in the bin (restorable).
      await deps.binService.eraseNow(copyId, a.id, 'Undo of a bulk Duplicate').catch((err: unknown) => deps.onError?.(err, 'erasing a copy on Undo (left in the Recycle Bin)'));
      if (t) deps.broadcast?.(t.projectId, 'task:deleted', { id: copyId });
      await deps.taskChanged?.(copyId).catch(() => undefined);
      return true;
    },
    archive: {
      plan: (a, ids, archiving) => deps.taskArchiveService.plan(a, ids, archiving),
      archive: (a, ids) => deps.taskArchiveService.archive(a, ids),
      unarchive: (a, ids) => deps.taskArchiveService.unarchive(a, ids),
    },
    async deleteRefusal(a, taskId) {
      // The delete rule (owner, 31 Oct): administrators and the people who run its project, only tasks
      // they created or that are assigned to them alone.
      const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { projectId: true, createdById: true, assignees: { select: { userId: true } } } });
      if (!t) return 'Task not found.';
      const mayManage = await deps.canManageProject(a.id, a.roles, t.projectId);
      if (!mayManage) return 'Only administrators and the people who run its project can delete its tasks.';
      return mayDeleteTask({ viewerId: a.id, mayManage, createdById: t.createdById, assigneeIds: t.assignees.map((x) => x.userId) }) ? null : DELETE_NOT_ALLOWED;
    },
    async deleteTask(a, taskId) {
      const gone = await deps.taskService.deleteTask(taskId, 'one', a.id);
      await deps.binService.deleted({ actorId: a.id, taskIds: gone.ids, batchId: gone.batchId }).catch((err: unknown) => deps.onError?.(err, 'recording a bulk delete'));
    },
    async inBinBy(ids, actorId, since) {
      if (ids.length === 0) return [];
      const rows = await prisma.task.findMany({ where: { id: { in: ids }, deletedAt: { gte: new Date(since.getTime() - 1000) }, deletedById: actorId, mergedIntoId: null }, select: { id: true } });
      return rows.map((r) => r.id);
    },
    async restore(a, ids) {
      const r = await deps.binService.restore(viewer(a), ids);
      return { restored: r.restored.map((x) => x.id), refused: r.notRestored.map((x) => ({ id: x.id, message: x.message })) };
    },

    store: {
      async save(r) {
        const row = await prisma.taskBulkAction.create({
          data: { actorId: r.actorId, action: r.action, changed: r.changed, undoUntil: r.undoUntil, undoData: r.entries as unknown as Prisma.InputJsonValue },
          select: { id: true },
        });
        return row.id;
      },
      async find(id): Promise<BulkRecord | null> {
        const row = await prisma.taskBulkAction.findUnique({ where: { id } });
        if (!row) return null;
        return { id: row.id, actorId: row.actorId, createdAt: row.createdAt, action: row.action as BulkRecord['action'], undoUntil: row.undoUntil, undoneAt: row.undoneAt, entries: (Array.isArray(row.undoData) ? row.undoData : []) as unknown as UndoEntry[] };
      },
      async claim(id, at) {
        // Once only, in one statement: two Undo clicks can't both put things back.
        const { count } = await prisma.taskBulkAction.updateMany({ where: { id, undoneAt: null }, data: { undoneAt: at } });
        return count === 1;
      },
    },
    collectNotices,
    async deliverNotices(all, ctx) {
      // Review M5: a type someone muted is left out before combining (their settings still apply).
      const notices: CreateNotificationData[] = [];
      for (const n of all) if (!(deps.isMuted && (await deps.isMuted(n.userId, n.type)))) notices.push(n);
      if (notices.length === 0) return;
      const actor = await prisma.user.findUnique({ where: { id: ctx.actorId }, select: { username: true, firstName: true, lastName: true } });
      const projectIds = [...new Set(ctx.projectOf.values())];
      const projects = new Map((projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }) : []).map((p) => [p.id, p.name]));
      const combined = combineNotices(notices, { actorName: actor ? displayName(actor) : 'Someone', projectName: (id) => projects.get(id), projectOf: (taskId) => ctx.projectOf.get(taskId) });
      for (const n of combined) {
        try {
          await deps.notify(n);
        } catch (err) {
          deps.onError?.(err, 'a combined notice');
        }
      }
    },
    audit: deps.audit ? (entry) => deps.audit!(entry) : undefined,
    broadcast: deps.broadcast,
    onError: deps.onError,
  };
}
