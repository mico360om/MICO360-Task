import type { Prisma, PrismaClient } from '@prisma/client';
import { categoryNameKey } from '../tasks/task-categories';

type Db = PrismaClient | Prisma.TransactionClient;

/** A task's categories by name (its project's order). */
export async function taskCategoryNames(db: Db, taskId: string): Promise<{ id: string; name: string; projectId: string }[]> {
  const rows = await db.taskCategory.findMany({ where: { taskId }, include: { category: true } });
  return rows.map((r) => r.category).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'en')).map((c) => ({ id: c.id, name: c.name, projectId: c.projectId }));
}

/**
 * 1.24: a task's categories in another project (a move, a merge into another project's task): the ones that
 * project has by name (case and spaces aside, retired ones too) become its; the rest are dropped. Writes
 * nothing — `applyCategoryPlan` does.
 */
export async function categoryPlanFor(db: Db, categories: { id: string; name: string; projectId: string }[], projectId: string): Promise<{ keep: string[]; drop: { id: string; name: string }[] }> {
  const theirs = await db.projectCategory.findMany({ where: { projectId }, select: { id: true, nameKey: true } });
  const byKey = new Map(theirs.map((c) => [c.nameKey, c.id]));
  const keep: string[] = [];
  const drop: { id: string; name: string }[] = [];
  for (const c of categories) {
    const match = c.projectId === projectId ? c.id : byKey.get(categoryNameKey(c.name));
    if (match) {
      if (!keep.includes(match)) keep.push(match);
    } else drop.push({ id: c.id, name: c.name });
  }
  return { keep, drop };
}

/** Give a task exactly these categories (ids of its project). */
export async function setTaskCategories(db: Db, taskId: string, categoryIds: string[], addedById: string | null): Promise<void> {
  await db.taskCategory.deleteMany({ where: { taskId, categoryId: { notIn: categoryIds } } });
  if (categoryIds.length) await db.taskCategory.createMany({ data: categoryIds.map((categoryId) => ({ taskId, categoryId, addedById })), skipDuplicates: true });
}
