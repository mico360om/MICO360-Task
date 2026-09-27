import type { PrismaClient } from '@prisma/client';
import type { DependencyRepository } from './dependency-repository';

export function createPrismaDependencyRepository(prisma: PrismaClient): DependencyRepository {
  return {
    async add(taskId, dependsOnTaskId) {
      const e = await prisma.taskDependency.create({ data: { taskId, dependsOnTaskId } });
      return { id: e.id, taskId: e.taskId, dependsOnTaskId: e.dependsOnTaskId };
    },
    async remove(taskId, dependsOnTaskId) {
      await prisma.taskDependency.deleteMany({ where: { taskId, dependsOnTaskId } });
    },
    async exists(taskId, dependsOnTaskId) {
      const found = await prisma.taskDependency.findUnique({
        where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
      });
      return found !== null;
    },
    async dependsOn(taskId) {
      // Deleted tasks no longer block anything.
      const rows = await prisma.taskDependency.findMany({ where: { taskId, dependsOn: { deletedAt: null } }, select: { dependsOnTaskId: true } });
      return rows.map((r) => r.dependsOnTaskId);
    },
    async blocks(taskId) {
      const rows = await prisma.taskDependency.findMany({ where: { dependsOnTaskId: taskId, task: { deletedAt: null } }, select: { taskId: true } });
      return rows.map((r) => r.taskId);
    },
  };
}
