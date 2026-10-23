import type { PrismaClient } from '@prisma/client';
import { toPerson } from './prisma-timeline-source';
import type { WorkloadStore } from './workload-service';

const personFields = { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } as const;
const ACTIVE = { deletedAt: null, status: 'ACTIVE' as const };
/** Projects the page works with: not deleted, completed or archived (as the timeline and the daily emails). */
const LIVE_PROJECT = { deletedAt: null, status: { notIn: ['COMPLETED' as const, 'ARCHIVED' as const] } };
/** The shared "open" rule: not in a Done column and no completion time. */
const OPEN = { deletedAt: null, completedAt: null, column: { category: { not: 'DONE' as const } } };

/**
 * The Workload page's reads, each one grouped query whatever the number of people. Plain reads:
 * which people and projects to ask for is decided by loadWorkload (workload-service.ts).
 */
export function createPrismaWorkloadStore(prisma: PrismaClient): WorkloadStore {
  return {
    async managedProjectIds(userId) {
      const managed = await prisma.project.findMany({
        where: { ...LIVE_PROJECT, OR: [{ managerId: userId }, { ownerId: userId }, { members: { some: { userId, role: 'MANAGER' } } }] },
        select: { id: true },
        orderBy: { name: 'asc' },
      });
      return managed.map((p) => p.id);
    },

    async liveProjects(ids) {
      if (ids && ids.length === 0) return [];
      return prisma.project.findMany({
        where: { ...LIVE_PROJECT, ...(ids ? { id: { in: ids } } : {}) },
        select: { id: true, code: true, name: true, color: true, icon: true, imageUrl: true, ownerId: true, managerId: true },
        orderBy: { name: 'asc' },
      });
    },

    async members(projectIds) {
      if (projectIds.length === 0) return [];
      return prisma.projectMember.findMany({ where: { projectId: { in: projectIds }, user: ACTIVE }, select: { projectId: true, userId: true } });
    },

    async activeUsers(ids) {
      if (ids && ids.length === 0) return [];
      const users = await prisma.user.findMany({ where: { ...ACTIVE, ...(ids ? { id: { in: ids } } : {}) }, select: personFields });
      return users.map(toPerson);
    },

    async openTasks({ projectIds, assigneeIds, from, to }) {
      if (projectIds.length === 0 || assigneeIds.length === 0) return [];
      const tasks = await prisma.task.findMany({
        where: { ...OPEN, projectId: { in: projectIds }, dueDate: { gte: from, lt: to }, assignees: { some: { userId: { in: assigneeIds } } } },
        select: { id: true, key: true, title: true, projectId: true, dueDate: true, priority: true, isMilestone: true, version: true, assignees: { select: { userId: true } } },
        orderBy: { dueDate: 'asc' },
      });
      return tasks.map(({ assignees, ...t }) => ({ ...t, assigneeIds: assignees.map((a) => a.userId) }));
    },

    async overdueCounts({ projectIds, userIds, before }) {
      if (projectIds.length === 0 || userIds.length === 0) return [];
      const groups = await prisma.taskAssignee.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, task: { is: { ...OPEN, projectId: { in: projectIds }, dueDate: { lt: before } } } },
        _count: { _all: true },
      });
      return groups.map((g) => ({ userId: g.userId, count: g._count._all }));
    },

    async openDue({ projectIds, userIds, windows }) {
      if (userIds.length === 0 || windows.length === 0 || (projectIds && projectIds.length === 0)) return [];
      const rows = await prisma.taskAssignee.findMany({
        where: {
          userId: { in: userIds },
          user: ACTIVE,
          task: {
            is: {
              ...OPEN,
              ...(projectIds ? { projectId: { in: projectIds } } : { project: { is: LIVE_PROJECT } }),
              OR: windows.map((w) => ({ dueDate: { gte: w.from, lt: w.to } })),
            },
          },
        },
        select: { userId: true, task: { select: { dueDate: true } } },
      });
      return rows.map((r) => ({ userId: r.userId, dueDate: r.task.dueDate }));
    },
  };
}
