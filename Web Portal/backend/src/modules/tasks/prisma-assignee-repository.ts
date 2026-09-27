import type { PrismaClient } from '@prisma/client';
import type { AssigneeRepository, TaskLookup } from './assignee-repository';

type Db = Pick<PrismaClient, 'project' | 'user'>;

/**
 * Active users among `userIds` (or everyone, when omitted) who can see the project: its owner,
 * manager, creator, members, and admins. Empty when the project is missing or deleted.
 */
export async function projectAudienceIds(db: Db, projectId: string, userIds?: string[]): Promise<string[]> {
  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { ownerId: true, managerId: true, createdById: true, members: { select: { userId: true } } },
  });
  if (!project) return [];
  const direct = [project.ownerId, project.managerId, project.createdById, ...project.members.map((m) => m.userId)].filter(
    (id): id is string => Boolean(id),
  );
  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      ...(userIds ? { id: { in: userIds } } : {}),
      OR: [{ id: { in: direct } }, { roles: { some: { role: { name: 'ADMIN' } } } }],
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
  };
}
