import type { PrismaClient } from '@prisma/client';
import { arrange, type ItemRow, type ListRow } from './checklist-tree';
import { isTaskDone } from './task-status';
import type { MyChecklistItem } from './checklist-routes';

/** "Checklist items for me" shows at most this many (the soonest due). */
const MINE_MAX = 500;
/** A live task: not deleted (or merged), its project not deleted — and not archived (task archive: its items leave My Tasks, the calendar and reminders). */
const liveTask = { deletedAt: null, archivedAt: null, project: { is: { deletedAt: null } } } as const;
const dayKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** An item with a due day on the calendar. */
export interface CalendarChecklistItem {
  id: string;
  text: string;
  done: boolean;
  dueDate: string;
  assigneeId: string | null;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  projectId: string;
}

/** An open dated item for the reminder sweep, with who it reminds (design call 4). */
export interface ReminderChecklistItem {
  id: string;
  text: string;
  dueDate: Date;
  assigneeId: string | null;
  taskId: string;
  taskKey: string;
  taskTitle: string;
}

/**
 * 1.23.3 — the checklist reads that cross tasks: a person's open items (My Tasks), dated items for the
 * calendar, and dated items for the due-soon / overdue reminders. A finished task, or one waiting for
 * approval, has no items "for me" and sends no reminders (design call 4).
 */
export function createPrismaChecklistQueries(prisma: PrismaClient) {
  /** Every live list and item of these tasks, arranged per task. */
  async function arrangedOf(taskIds: string[]) {
    if (!taskIds.length) return new Map<string, ReturnType<typeof arrange>>();
    const [lists, items] = await Promise.all([
      prisma.checklistList.findMany({ where: { taskId: { in: taskIds }, deletedAt: null } }),
      prisma.checklistItem.findMany({ where: { taskId: { in: taskIds }, deletedAt: null } }),
    ]);
    const out = new Map<string, ReturnType<typeof arrange>>();
    for (const id of taskIds) out.set(id, arrange(lists.filter((l) => l.taskId === id) as ListRow[], items.filter((i) => i.taskId === id) as ItemRow[]));
    return out;
  }

  return {
    /** My Tasks → "Checklist items for me": open items given to this person, in these projects (null = any). */
    async mine(userId: string, projectIds: string[] | null): Promise<MyChecklistItem[]> {
      if (projectIds && projectIds.length === 0) return [];
      const where = {
        assigneeId: userId,
        done: false,
        deletedAt: null,
        task: { ...liveTask, approvalRequestedAt: null, completedAt: null, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
      };
      const select = { id: true, taskId: true, task: { select: { key: true, title: true, projectId: true, column: { select: { category: true } } } } } as const;
      // The 500 soonest: dated ones first (soonest due), then undated ones (oldest first).
      const dated = await prisma.checklistItem.findMany({ where: { ...where, dueDate: { not: null } }, select, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: MINE_MAX });
      const undated = dated.length < MINE_MAX ? await prisma.checklistItem.findMany({ where: { ...where, dueDate: null }, select, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MINE_MAX - dated.length }) : [];
      const rows = [...dated, ...undated];
      const open = rows.filter((r) => !isTaskDone({ columnCategory: r.task.column?.category ?? null, completedAt: null }));
      const arranged = await arrangedOf([...new Set(open.map((r) => r.taskId))]);
      const out: MyChecklistItem[] = [];
      for (const r of open) {
        const a = arranged.get(r.taskId);
        const item = a?.items.find((i) => i.id === r.id);
        const list = item && a?.lists.find((l) => l.id === item.listId);
        if (!item || !list) continue;
        out.push({
          id: item.id,
          text: item.text,
          done: item.done,
          dueDate: dayKey(item.dueDate),
          isParent: item.childCount > 0,
          openSubItems: item.subTotal - item.subDone,
          taskId: r.taskId,
          taskKey: r.task.key,
          taskTitle: r.task.title,
          projectId: r.task.projectId,
          listId: list.id,
          listTitle: list.title,
        });
      }
      // Soonest first; undated last; then by task number and the item's place in its task.
      return out.sort((x, y) => (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999') || x.taskKey.localeCompare(y.taskKey, undefined, { numeric: true }));
    },

    /**
     * Dated items on the calendar between two days (inclusive): in `ownIds` projects (null = any), and in
     * `listIds` projects (null = any) or given to `userId` — as the calendar shows tasks.
     */
    async due(opts: { from: string; to: string; userId: string; ownIds: string[] | null; listIds: string[] | null }): Promise<CalendarChecklistItem[]> {
      if (opts.ownIds && opts.ownIds.length === 0) return [];
      const rows = await prisma.checklistItem.findMany({
        where: {
          deletedAt: null,
          dueDate: { gte: new Date(`${opts.from}T00:00:00.000Z`), lte: new Date(`${opts.to}T00:00:00.000Z`) },
          task: { ...liveTask, ...(opts.ownIds ? { projectId: { in: opts.ownIds } } : {}) },
          ...(opts.listIds ? { OR: [{ task: { projectId: { in: opts.listIds } } }, { assigneeId: opts.userId }] } : {}),
        },
        select: { id: true, text: true, done: true, dueDate: true, assigneeId: true, taskId: true, task: { select: { key: true, title: true, projectId: true } } },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      });
      return rows.map((r) => ({ id: r.id, text: r.text, done: r.done, dueDate: dayKey(r.dueDate)!, assigneeId: r.assigneeId, taskId: r.taskId, taskKey: r.task.key, taskTitle: r.task.title, projectId: r.task.projectId }));
    },

    /** Open dated items of open tasks (not waiting for approval), with the task's assignees. */
    async forReminders(): Promise<(ReminderChecklistItem & { taskAssigneeIds: string[] })[]> {
      const rows = await prisma.checklistItem.findMany({
        where: { deletedAt: null, done: false, dueDate: { not: null }, task: { ...liveTask, completedAt: null, approvalRequestedAt: null } },
        select: {
          id: true,
          text: true,
          dueDate: true,
          assigneeId: true,
          taskId: true,
          parentId: true,
          task: { select: { key: true, title: true, column: { select: { category: true } }, assignees: { select: { userId: true } } } },
        },
      });
      return rows
        .filter((r) => !isTaskDone({ columnCategory: r.task.column?.category ?? null, completedAt: null }))
        .map((r) => ({
          id: r.id,
          text: r.text,
          dueDate: r.dueDate!,
          assigneeId: r.assigneeId,
          taskId: r.taskId,
          taskKey: r.task.key,
          taskTitle: r.task.title,
          taskAssigneeIds: r.task.assignees.map((a) => a.userId),
        }));
    },
  };
}

export type ChecklistQueries = ReturnType<typeof createPrismaChecklistQueries>;
