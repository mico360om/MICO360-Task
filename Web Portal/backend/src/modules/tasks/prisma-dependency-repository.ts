import type { Prisma, PrismaClient } from '@prisma/client';
import { withSentinelLock } from '../../lib/sentinel-lock';
import type { DependencyRepository } from './dependency-repository';

/** Review fix #12: the job_locks row every new link holds first (made when missing; no scheduled job uses it). */
export const DEPENDENCY_LOCK = 'task-dependencies';

type Db = PrismaClient | Prisma.TransactionClient;

function linksOn(db: Db): DependencyRepository {
  return {
    async add(taskId, dependsOnTaskId) {
      const e = await db.taskDependency.create({ data: { taskId, dependsOnTaskId } });
      return { id: e.id, taskId: e.taskId, dependsOnTaskId: e.dependsOnTaskId };
    },
    async remove(taskId, dependsOnTaskId) {
      await db.taskDependency.deleteMany({ where: { taskId, dependsOnTaskId } });
    },
    async exists(taskId, dependsOnTaskId) {
      const found = await db.taskDependency.findUnique({
        where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
      });
      return found !== null;
    },
    async dependsOn(taskId) {
      // Deleted tasks no longer block anything.
      const rows = await db.taskDependency.findMany({ where: { taskId, dependsOn: { deletedAt: null } }, select: { dependsOnTaskId: true } });
      return rows.map((r) => r.dependsOnTaskId);
    },
    async dependsOnAny(taskId) {
      // N12: those in the Recycle Bin too (restored, a task brings its links back).
      const rows = await db.taskDependency.findMany({ where: { taskId }, select: { dependsOnTaskId: true } });
      return rows.map((r) => r.dependsOnTaskId);
    },
    async blocks(taskId) {
      const rows = await db.taskDependency.findMany({ where: { dependsOnTaskId: taskId, task: { deletedAt: null } }, select: { taskId: true } });
      return rows.map((r) => r.taskId);
    },
  };
}

export function createPrismaDependencyRepository(prisma: PrismaClient): DependencyRepository {
  return {
    ...linksOn(prisma),
    // Review fix #12: the hold is the transaction's first statement, so the loop check reads every link
    // added before it (lib/sentinel-lock: no isolation statement; a deadlock or MariaDB 1020 is tried again).
    oneAtATime: (work) => withSentinelLock(prisma, DEPENDENCY_LOCK, (tx) => work(linksOn(tx))),
  };
}
