import { type PrismaClient, type ProjectMemberRole } from '@prisma/client';
import type { MemberRepository, ProjectExistsLookup } from './member-repository';
import type { ProjectManagerLookup } from './project-authz';

export function createPrismaMemberRepository(prisma: PrismaClient): MemberRepository {
  return {
    async list(projectId) {
      const rows = await prisma.projectMember.findMany({
        where: { projectId },
        include: { user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } } },
        orderBy: { addedAt: 'asc' },
      });
      return rows.map((r) => ({ ...r.user, role: r.role }));
    },
    async add(projectId, userId) {
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: {},
        create: { projectId, userId },
      });
    },
    async remove(projectId, userId) {
      await prisma.projectMember.deleteMany({ where: { projectId, userId } });
    },
    async setRole(projectId, userId, role) {
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId, userId } },
        data: { role: role as ProjectMemberRole },
      });
    },
    async hasImplicitAccess(projectId, userId) {
      const [project, admin] = await Promise.all([
        prisma.project.findFirst({
          where: { id: projectId, OR: [{ ownerId: userId }, { managerId: userId }, { createdById: userId }] },
          select: { id: true },
        }),
        prisma.userRole.findFirst({ where: { userId, role: { name: 'ADMIN' } }, select: { userId: true } }),
      ]);
      return project !== null || admin !== null;
    },
    async removeTaskLinks(projectId, userId) {
      await prisma.$transaction([
        prisma.taskAssignee.deleteMany({ where: { userId, task: { projectId } } }),
        prisma.taskWatcher.deleteMany({ where: { userId, task: { projectId } } }),
      ]);
    },
  };
}

export function createPrismaProjectManagerLookup(prisma: PrismaClient): ProjectManagerLookup {
  return {
    async isManager(userId, projectId) {
      const m = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { role: true } });
      return m?.role === 'MANAGER';
    },
    async projectIdOfColumn(columnId) {
      const c = await prisma.kanbanColumn.findUnique({ where: { id: columnId }, select: { projectId: true } });
      return c?.projectId ?? null;
    },
    async projectIdOfTask(taskId) {
      // A task of a deleted project resolves to nothing, so nobody but an admin can reach it.
      const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } }, select: { projectId: true } });
      return t?.projectId ?? null;
    },
  };
}

export function createPrismaProjectExistsLookup(prisma: PrismaClient): ProjectExistsLookup {
  return {
    async exists(projectId) {
      const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
      return p !== null;
    },
  };
}
