import type { PrismaClient } from '@prisma/client';
import type { WatcherRepository } from './watcher-repository';

export function createPrismaWatcherRepository(prisma: PrismaClient): WatcherRepository {
  return {
    async add(taskId, userId) {
      await prisma.taskWatcher.upsert({
        where: { taskId_userId: { taskId, userId } },
        update: {},
        create: { taskId, userId },
      });
    },
    async remove(taskId, userId) {
      await prisma.taskWatcher.deleteMany({ where: { taskId, userId } });
    },
    async list(taskId) {
      const rows = await prisma.taskWatcher.findMany({ where: { taskId }, include: { user: true } });
      return rows.map((r) => ({
        id: r.user.id,
        username: r.user.username,
        email: r.user.email,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
      }));
    },
    async isWatching(taskId, userId) {
      const row = await prisma.taskWatcher.findUnique({ where: { taskId_userId: { taskId, userId } }, select: { taskId: true } });
      return row !== null;
    },
    async listWatcherIds(taskId) {
      const rows = await prisma.taskWatcher.findMany({ where: { taskId }, select: { userId: true } });
      return rows.map((r) => r.userId);
    },
  };
}
