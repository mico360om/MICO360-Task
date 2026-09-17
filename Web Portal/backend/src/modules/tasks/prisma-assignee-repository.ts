import type { PrismaClient } from '@prisma/client';
import type { AssigneeRepository, TaskLookup } from './assignee-repository';

export function createPrismaAssigneeRepository(prisma: PrismaClient): AssigneeRepository {
  return {
    async add(taskId, userId) {
      await prisma.taskAssignee.upsert({
        where: { taskId_userId: { taskId, userId } },
        update: {},
        create: { taskId, userId },
      });
    },
    async remove(taskId, userId) {
      await prisma.taskAssignee.deleteMany({ where: { taskId, userId } });
    },
    async list(taskId) {
      const rows = await prisma.taskAssignee.findMany({ where: { taskId }, include: { user: true } });
      return rows.map((r) => ({
        id: r.user.id,
        username: r.user.username,
        email: r.user.email,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
      }));
    },
  };
}

export function createPrismaTaskLookup(prisma: PrismaClient): TaskLookup {
  return {
    async exists(id) {
      const t = await prisma.task.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      return t !== null;
    },
  };
}
