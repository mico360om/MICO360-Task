import type { PrismaClient } from '@prisma/client';
import { liveTaskWhere } from './prisma-task-repository';
import type { TaskArchivePorts } from './task-archive';

/** Task archive's reads and writes over the database (its other ports are other services'). */
export function createPrismaTaskArchiveStore(prisma: PrismaClient): Pick<TaskArchivePorts, 'find' | 'setArchived'> {
  return {
    async find(ids) {
      if (ids.length === 0) return [];
      return prisma.task.findMany({ where: { id: { in: ids }, ...liveTaskWhere }, select: { id: true, key: true, title: true, projectId: true, archivedAt: true } });
    },
    async setArchived(taskId, value) {
      // Only from the state it was read in, in one statement: two archives at once write once.
      const { count } = await prisma.task.updateMany({
        where: { id: taskId, deletedAt: null, archivedAt: value ? null : { not: null } },
        data: value ? { archivedAt: value.at, archivedById: value.by, version: { increment: 1 } } : { archivedAt: null, archivedById: null, version: { increment: 1 } },
      });
      return count > 0;
    },
  };
}
