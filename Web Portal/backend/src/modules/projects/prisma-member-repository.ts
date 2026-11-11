import { type PrismaClient, type ProjectMemberRole } from '@prisma/client';
import type { MemberRepository, ProjectExistsLookup } from './member-repository';
import type { ProjectManagerLookup } from './project-authz';
import { managedVisibleWhere } from './project-managers';
import { ConflictError } from '../../lib/http-errors';
import { PERSON_SUMMARY_SELECT, photoOf } from '../../lib/person-summary';

export function createPrismaMemberRepository(prisma: PrismaClient): MemberRepository {
  return {
    async list(projectId) {
      const rows = await prisma.projectMember.findMany({
        where: { projectId },
        include: { user: { select: { ...PERSON_SUMMARY_SELECT, email: true } } },
        orderBy: { addedAt: 'asc' },
      });
      // Avatar hotfix: each member's photo comes with the row (null: initials).
      return rows.map((r) => ({ ...r.user, avatarUrl: photoOf(r.user.avatarUrl), role: r.role }));
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
    async removeTaskLinks(projectId, userId, actorId) {
      const [on, person] = await Promise.all([
        prisma.taskAssignee.findMany({ where: { userId, task: { projectId } }, select: { taskId: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, username: true } }),
      ]);
      const assignee = person ? [person.firstName, person.lastName].filter(Boolean).join(' ').trim() || person.username : userId;
      await prisma.$transaction([
        ...(on.length
          ? [prisma.activity.createMany({ data: on.map((a) => ({ taskId: a.taskId, projectId, userId: actorId ?? userId, action: 'UNASSIGNED', meta: { assigneeId: userId, assignee, released: true } })) })]
          : []),
        prisma.taskAssignee.deleteMany({ where: { userId, task: { projectId } } }),
        prisma.taskWatcher.deleteMany({ where: { userId, task: { projectId } } }),
      ]);
    },
  };
}

export function createPrismaProjectManagerLookup(prisma: PrismaClient): ProjectManagerLookup {
  return {
    // Who runs a project: its owner, its named manager or a MANAGER member (project-managers), while
    // they share one of its active companies (companies: managedVisibleWhere). A deleted project is
    // nobody's to run.
    async managesProject(userId, projectId) {
      const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null, ...managedVisibleWhere(userId) }, select: { id: true } });
      return p !== null;
    },
    async managedAmong(userId, projectIds) {
      if (projectIds.length === 0) return [];
      const ps = await prisma.project.findMany({ where: { id: { in: projectIds }, deletedAt: null, ...managedVisibleWhere(userId) }, select: { id: true } });
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
 * rule) — active people only, each once, who can still see it: an administrator, or someone in one of
 * the project's active companies (companies: someone who lost the company hears nothing of it). For
 * notices only the people running a project should get (escalations).
 */
export async function projectRunnerIds(prisma: PrismaClient, projectIds: string[]): Promise<Map<string, string[]>> {
  if (projectIds.length === 0) return new Map();
  const runnersOf = (p: { ownerId: string | null; managerId: string | null; members: { userId: string }[] }) =>
    [p.ownerId, p.managerId, ...p.members.map((m) => m.userId)].filter((x): x is string => !!x);
  const people = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, ownerId: true, managerId: true, members: { where: { role: 'MANAGER' }, select: { userId: true } } },
  });
  const all = [...new Set(people.flatMap(runnersOf))];
  if (all.length === 0) return new Map(people.map((p) => [p.id, []]));
  const [users, sharing] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: all }, deletedAt: null, status: 'ACTIVE' }, select: { id: true, roles: { select: { role: { select: { name: true } } } } } }),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, companies: { where: { company: { status: 'ACTIVE' } }, select: { company: { select: { members: { where: { userId: { in: all } }, select: { userId: true } } } } } } },
    }),
  ]);
  const active = new Set(users.map((u) => u.id));
  const admins = new Set(users.filter((u) => u.roles.some((r) => r.role.name === 'ADMIN')).map((u) => u.id));
  const inCompany = new Map(sharing.map((p) => [p.id, new Set(p.companies.flatMap((c) => c.company.members.map((m) => m.userId)))]));
  return new Map(
    people.map((p) => [p.id, [...new Set(runnersOf(p).filter((x) => active.has(x) && (admins.has(x) || inCompany.get(p.id)?.has(x))))]]),
  );
}
