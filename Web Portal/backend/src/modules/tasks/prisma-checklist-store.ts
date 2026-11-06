import { Prisma, type PrismaClient } from '@prisma/client';
import { cloneRows, diffRows, type ChecklistRows, type ChecklistStore } from './checklist-store';
import { leafPercent, type ItemRow, type ListRow } from './checklist-tree';

type Db = PrismaClient | Prisma.TransactionClient;

/** A live task: not deleted (or merged), its project not deleted. */
const liveTask = (id: string) => ({ id, deletedAt: null, project: { is: { deletedAt: null } } });

/**
 * 1.23.3 — the one raw statement of nested checklists: hold the task's row for the rest of the
 * transaction, so a task's checklist changes happen one at a time (two ticks at once can never leave a
 * parent wrong). Plain `SELECT … FOR UPDATE` on one table: MySQL 8 and MariaDB read it alike.
 */
export const LOCK_TASK_SQL = 'SELECT `id` FROM `tasks` WHERE `id` = ? AND `deletedAt` IS NULL FOR UPDATE';

async function rowsOf(db: Db, taskId: string): Promise<ChecklistRows> {
  const [lists, items] = await Promise.all([
    db.checklistList.findMany({ where: { taskId } }),
    db.checklistItem.findMany({ where: { taskId } }),
  ]);
  return { lists: lists as ListRow[], items: items as ItemRow[] };
}

/** Save what a change did: new lists, then new items, then changed rows (same change → one write). */
async function save(tx: Prisma.TransactionClient, before: ChecklistRows, after: ChecklistRows): Promise<void> {
  const d = diffRows(before, after);
  if (d.lists.added.length) await tx.checklistList.createMany({ data: d.lists.added });
  if (d.items.added.length) await tx.checklistItem.createMany({ data: d.items.added });
  const grouped = (changes: { id: string; data: Record<string, unknown> }[]) => {
    const groups = new Map<string, { ids: string[]; data: Record<string, unknown> }>();
    for (const c of changes) {
      const key = JSON.stringify(c.data);
      const g = groups.get(key) ?? { ids: [], data: c.data };
      g.ids.push(c.id);
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  for (const g of grouped(d.lists.changed)) await tx.checklistList.updateMany({ where: { id: { in: g.ids } }, data: g.data });
  for (const g of grouped(d.items.changed)) await tx.checklistItem.updateMany({ where: { id: { in: g.ids } }, data: g.data });
}

export function createPrismaChecklistStore(prisma: PrismaClient): ChecklistStore & { selfCheck(taskId: string): Promise<void> } {
  return {
    async read(taskId) {
      if (!(await prisma.task.findFirst({ where: liveTask(taskId), select: { id: true } }))) return null;
      return rowsOf(prisma, taskId);
    },
    async edit(taskId, change) {
      return prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(LOCK_TASK_SQL, taskId);
          if (!(await tx.task.findFirst({ where: liveTask(taskId), select: { id: true } }))) return null;
          const before = await rowsOf(tx, taskId);
          const draft = cloneRows(before);
          const value = await change(draft);
          await save(tx, before, draft);
          return { value };
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    },
    async taskOfItem(itemId) {
      const i = await prisma.checklistItem.findFirst({ where: { id: itemId, deletedAt: null, task: { deletedAt: null, project: { is: { deletedAt: null } } } }, select: { taskId: true } });
      return i?.taskId ?? null;
    },
    async taskOfList(listId) {
      const l = await prisma.checklistList.findFirst({ where: { id: listId, deletedAt: null, task: { deletedAt: null, project: { is: { deletedAt: null } } } }, select: { taskId: true } });
      return l?.taskId ?? null;
    },
    async purge(before) {
      const items = await prisma.checklistItem.deleteMany({ where: { deletedAt: { lt: before } } });
      // A checklist's own items went with it (same time); anything still in it goes with it (cascade).
      const lists = await prisma.checklistList.deleteMany({ where: { deletedAt: { lt: before } } });
      return items.count + lists.count;
    },
    /** The start-up database check: the hold, on a task no row has (nothing found, nothing written). */
    async selfCheck(taskId) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(LOCK_TASK_SQL, taskId);
        await rowsOf(tx, taskId);
      });
    },
  };
}

/** A task's checklist progress (0–100) from its live leaves — what a re-opened task goes back to. */
export async function checklistPercentOf(db: Db, taskId: string): Promise<number> {
  const items = await db.checklistItem.findMany({ where: { taskId, deletedAt: null }, select: { id: true, parentId: true, done: true } });
  return leafPercent(items);
}
