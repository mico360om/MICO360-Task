import type { PrismaClient } from '@prisma/client';
import type { AssigneeRepository, TaskLookup } from './assignee-repository';
import { sharesProjectCompanyWhere } from '../companies/company-access';
import { ConflictError, NotFoundError } from '../../lib/http-errors';
import { withRowLock } from '../../lib/sentinel-lock';

/** N12: the Workload swap holds the task's row first (its version), as the other task edits' single statement does. */
export const LOCK_TASK_VERSION_SQL = 'SELECT version FROM tasks WHERE id = ? AND deletedAt IS NULL FOR UPDATE';

type Db = Pick<PrismaClient, 'project' | 'user'>;

/**
 * Active users among `userIds` (or everyone, when omitted) who can see the project: its owner,
 * named manager and team who share one of its active companies, and admins. Empty when the project
 * is missing or deleted.
 */
export async function projectAudienceIds(db: Db, projectId: string, userIds?: string[]): Promise<string[]> {
  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { ownerId: true, managerId: true, members: { select: { userId: true } } },
  });
  if (!project) return [];
  const direct = [project.ownerId, project.managerId, ...project.members.map((m) => m.userId)].filter(
    (id): id is string => Boolean(id),
  );
  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      ...(userIds ? { id: { in: userIds } } : {}),
      OR: [{ id: { in: direct }, ...sharesProjectCompanyWhere(projectId) }, { roles: { some: { role: { name: 'ADMIN' } } } }],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

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
    async eligibleUserIds(projectId, userIds) {
      return userIds.length ? projectAudienceIds(prisma, projectId, userIds) : [];
    },
    async swap(taskId, fromId, toId, opts = {}) {
      await withRowLock(
        prisma,
        (tx) => tx.$queryRawUnsafe<Array<{ version: number | bigint }>>(LOCK_TASK_VERSION_SQL, taskId),
        async (tx, [task]) => {
          if (!task) throw new NotFoundError('Task not found.');
          if (opts.expectedVersion !== undefined && Number(task.version) !== opts.expectedVersion) {
            throw new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
          }
          if (!(await tx.taskAssignee.findUnique({ where: { taskId_userId: { taskId, userId: fromId } }, select: { userId: true } }))) {
            throw new ConflictError('That person is no longer on this task.', 'ASSIGNEE_GONE');
          }
          // Like every task edit: the version moves on, so an edit made from the one read before is refused.
          await tx.task.update({ where: { id: taskId }, data: { version: { increment: 1 } }, select: { id: true } });
          await tx.taskAssignee.upsert({ where: { taskId_userId: { taskId, userId: toId } }, update: {}, create: { taskId, userId: toId } });
          await tx.taskAssignee.deleteMany({ where: { taskId, userId: fromId } });
        },
      );
    },
    async projectIdOfTask(taskId) {
      const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } }, select: { projectId: true } });
      return t?.projectId ?? null;
    },
  };
}

export function createPrismaTaskLookup(prisma: PrismaClient): TaskLookup {
  return {
    async exists(id) {
      // A task of a deleted project is gone too.
      const t = await prisma.task.findFirst({ where: { id, deletedAt: null, project: { is: { deletedAt: null } } }, select: { id: true } });
      return t !== null;
    },
    async state(id) {
      const t = await prisma.task.findFirst({
        where: { id, deletedAt: null, project: { is: { deletedAt: null } } },
        select: { version: true, completedAt: true, column: { select: { category: true } } },
      });
      return t ? { version: t.version, done: t.completedAt !== null || t.column.category === 'DONE' } : null;
    },
  };
}
