import { type PrismaClient, type ProjectMemberRole } from '@prisma/client';
import type { MemberRepository, ProjectExistsLookup } from './member-repository';
import type { ProjectManagerLookup } from './project-authz';
import { managedProjectsWhere } from './project-managers';
import { ConflictError } from '../../lib/http-errors';

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
          where: { id: projectId, OR: [{ ownerId: userId }, { managerId: userId }] },
          select: { id: true },
        }),
        prisma.userRole.findFirst({ where: { userId, role: { name: 'ADMIN' } }, select: { userId: true } }),
      ]);
      return project !== null || admin !== null;
    },
    async changeGuarded(projectId, userId, change) {
      await prisma.$transaction(async (tx) => {
        // Hold the project's row: two managers stepping down at once are decided one after the other.
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
        const current = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { role: true } });
        const stepsDown = current?.role === 'MANAGER' && ('remove' in change || change.role !== 'MANAGER');
        if (stepsDown) {
          // Who else runs it: its owner and named manager (team changes don't touch those — this
          // person too, if they hold one), and the other MANAGER members. Only active people count.
          const p = await tx.project.findUnique({
            where: { id: projectId },
            select: { ownerId: true, managerId: true, members: { where: { role: 'MANAGER', userId: { not: userId } }, select: { userId: true } } },
          });
          const others = [...new Set([p?.ownerId, p?.managerId, ...(p?.members ?? []).map((m) => m.userId)].filter((x): x is string => !!x))];
          const active = others.length ? await tx.user.count({ where: { id: { in: others }, deletedAt: null, status: 'ACTIVE' } }) : 0;
          if (active === 0) throw new ConflictError('Someone has to run this project. Make another member a manager, or give it an owner, first.', 'LAST_PROJECT_MANAGER');
        }
        if ('remove' in change) await tx.projectMember.deleteMany({ where: { projectId, userId } });
        else await tx.projectMember.update({ where: { projectId_userId: { projectId, userId } }, data: { role: change.role as ProjectMemberRole } });
      });
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
    // Who runs a project: its owner, its named manager or a MANAGER member (project-managers). A
    // deleted project is nobody's to run.
    async managesProject(userId, projectId) {
      const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null, ...managedProjectsWhere(userId) }, select: { id: true } });
      return p !== null;
    },
    async managedAmong(userId, projectIds) {
      if (projectIds.length === 0) return [];
      const ps = await prisma.project.findMany({ where: { id: { in: projectIds }, deletedAt: null, ...managedProjectsWhere(userId) }, select: { id: true } });
      return ps.map((p) => p.id);
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

/**
 * Who runs each project — its owner, its named manager and its MANAGER members (the project-managers
 * rule) — active people only, each once. For notices only the people running a project should get.
 */
export async function projectRunnerIds(prisma: PrismaClient, projectIds: string[]): Promise<Map<string, string[]>> {
  if (projectIds.length === 0) return new Map();
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, ownerId: true, managerId: true, members: { where: { role: 'MANAGER' }, select: { userId: true } } },
  });
  const all = [...new Set(projects.flatMap((p) => [p.ownerId, p.managerId, ...p.members.map((m) => m.userId)]).filter((x): x is string => !!x))];
  const active = new Set(
    all.length ? (await prisma.user.findMany({ where: { id: { in: all }, deletedAt: null, status: 'ACTIVE' }, select: { id: true } })).map((u) => u.id) : [],
  );
  return new Map(
    projects.map((p) => [p.id, [...new Set([p.ownerId, p.managerId, ...p.members.map((m) => m.userId)].filter((x): x is string => !!x && active.has(x)))]]),
  );
}
