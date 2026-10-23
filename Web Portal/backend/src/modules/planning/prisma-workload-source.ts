import type { PrismaClient } from '@prisma/client';
import { toPerson } from './prisma-timeline-source';
import type { WorkloadRows, WorkloadSource } from './workload';

const personFields = { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } as const;
const ACTIVE = { deletedAt: null, status: 'ACTIVE' as const };
/** Projects the page works with: not deleted and not archived. */
const LIVE_PROJECT = { deletedAt: null, status: { not: 'ARCHIVED' as const } };

/**
 * The Workload page's rows straight from the database, in six queries for any number of people:
 * the projects in scope, their teams, the people shown, who of the teams is active, the open
 * tasks due in the window with their assignees, and each person's overdue tasks.
 */
export function createPrismaWorkloadSource(prisma: PrismaClient): WorkloadSource {
  return {
    async managedProjectIds(userId) {
      const managed = await prisma.project.findMany({
        where: { ...LIVE_PROJECT, OR: [{ managerId: userId }, { ownerId: userId }, { members: { some: { userId, role: 'MANAGER' } } }] },
        select: { id: true },
        orderBy: { name: 'asc' },
      });
      return managed.map((p) => p.id);
    },

    async load({ scope, viewerId, from, to, overdueBefore }): Promise<WorkloadRows> {
      const projects = await prisma.project.findMany({
        where: { ...LIVE_PROJECT, ...(scope.projectIds ? { id: { in: scope.projectIds } } : {}) },
        select: { id: true, code: true, name: true, color: true, icon: true, imageUrl: true, ownerId: true, managerId: true },
        orderBy: { name: 'asc' },
      });
      const projectIds = projects.map((p) => p.id);
      // A project's team: its active members, its owner and its manager (who may be assigned its work).
      const members = projectIds.length
        ? await prisma.projectMember.findMany({ where: { projectId: { in: projectIds }, user: ACTIVE }, select: { projectId: true, userId: true } })
        : [];
      const leads = projects.flatMap((p) => [p.ownerId, p.managerId].filter((id): id is string => !!id).map((userId) => ({ projectId: p.id, userId })));
      const candidates = [...new Set([viewerId, ...members.map((m) => m.userId), ...leads.map((l) => l.userId)])];
      const [everyone, active] = await Promise.all([
        scope.kind === 'everyone' ? prisma.user.findMany({ where: ACTIVE, select: personFields }) : Promise.resolve(null),
        prisma.user.findMany({ where: { ...ACTIVE, id: { in: candidates } }, select: personFields }),
      ]);
      const activeIds = new Set((everyone ?? active).map((u) => u.id));
      for (const u of active) activeIds.add(u.id);
      const teams = [...members, ...leads.filter((l) => activeIds.has(l.userId))];
      const people = (everyone ?? (scope.kind === 'teams' ? active : active.filter((u) => u.id === viewerId))).map(toPerson);
      const peopleIds = people.map((p) => p.id);
      if (peopleIds.length === 0 || projectIds.length === 0) {
        return { people, projects: projects.map(({ ownerId: _o, managerId: _m, ...p }) => p), tasks: [], overdue: [], teams };
      }

      // Open = the shared "not done" rule: not in a Done column and no completion time.
      const open = { deletedAt: null, completedAt: null, column: { category: { not: 'DONE' as const } }, projectId: { in: projectIds } };
      const [tasks, overdue] = await Promise.all([
        prisma.task.findMany({
          where: { ...open, dueDate: { gte: from, lt: to }, assignees: { some: { userId: { in: peopleIds } } } },
          select: { id: true, key: true, title: true, projectId: true, dueDate: true, priority: true, isMilestone: true, version: true, assignees: { select: { userId: true } } },
          orderBy: { dueDate: 'asc' },
        }),
        prisma.taskAssignee.findMany({
          where: { userId: { in: peopleIds }, task: { ...open, dueDate: { lt: overdueBefore } } },
          select: { userId: true, task: { select: { projectId: true, dueDate: true } } },
        }),
      ]);
      return {
        people,
        projects: projects.map(({ ownerId: _o, managerId: _m, ...p }) => p),
        tasks: tasks.map(({ assignees, ...t }) => ({ ...t, assigneeIds: assignees.map((a) => a.userId) })),
        overdue: overdue.map((o) => ({ userId: o.userId, projectId: o.task.projectId, dueDate: o.task.dueDate })),
        teams,
      };
    },
  };
}
