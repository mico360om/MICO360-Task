import type { PrismaClient } from '@prisma/client';

/**
 * 1.22.3: tasks' current numbers by id — a meeting note's task, an action item's, the minutes'. A task
 * in the trash, or in a project in the trash, is left out. With `projectIds` (1.22.3 review: the
 * projects whose tasks the reader may open), so is a task outside them; null or absent: every project.
 */
export type ResolveTaskKeys = (taskIds: string[], projectIds?: readonly string[] | null) => Promise<Record<string, string>>;

export function createPrismaTaskKeyResolver(prisma: PrismaClient): ResolveTaskKeys {
  return async (ids, projectIds = null) => {
    if (ids.length === 0 || projectIds?.length === 0) return {};
    const rows = await prisma.task.findMany({
      where: { id: { in: ids }, deletedAt: null, project: { deletedAt: null }, ...(projectIds ? { projectId: { in: [...projectIds] } } : {}) },
      select: { id: true, key: true },
    });
    return Object.fromEntries(rows.map((t) => [t.id, t.key]));
  };
}
