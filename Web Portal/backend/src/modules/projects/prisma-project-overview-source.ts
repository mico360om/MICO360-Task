import type { PrismaClient } from '@prisma/client';
import type { OverviewPerson, ProjectOverviewSource, ProjectOverviewRows } from './project-overview';

const personFields = { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } as const;
const toPerson = (u: { id: string; firstName: string; lastName: string; username: string; avatarUrl: string | null }): OverviewPerson => ({
  id: u.id,
  name: `${u.firstName} ${u.lastName}`.trim() || u.username,
  avatarUrl: u.avatarUrl,
});

/**
 * The projects list's figures straight from the database, as grouped counts: every live task per
 * project (with its latest change), the open ones per project and due date, the teams and the
 * owners — four queries for the whole list, never one per project.
 */
export function createPrismaProjectOverviewSource(prisma: PrismaClient): ProjectOverviewSource {
  return {
    async load(projectIds, ownerIds): Promise<ProjectOverviewRows> {
      if (projectIds.length === 0) return { totals: [], openByDue: [], waitingByDue: [], members: [], owners: [] };
      const inProjects = { deletedAt: null, projectId: { in: projectIds } };
      // Open = the shared "not done" rule: not in a Done column and no completion time.
      const open = { ...inProjects, completedAt: null, column: { category: { not: 'DONE' as const } } };
      const [totals, openByDue, waitingByDue, members, owners] = await Promise.all([
        prisma.task.groupBy({ by: ['projectId'], where: inProjects, _count: { _all: true }, _max: { updatedAt: true } }),
        prisma.task.groupBy({ by: ['projectId', 'dueDate'], where: open, _count: { _all: true } }),
        // The open ones waiting for approval: never overdue while they wait.
        prisma.task.groupBy({ by: ['projectId', 'dueDate'], where: { ...open, approvalRequestedAt: { not: null } }, _count: { _all: true } }),
        prisma.projectMember.findMany({
          // Faces of people still active (not deleted, deactivated or suspended).
          where: { projectId: { in: projectIds }, user: { deletedAt: null, status: 'ACTIVE' } },
          select: { projectId: true, user: { select: personFields } },
          orderBy: { addedAt: 'asc' },
        }),
        ownerIds.length ? prisma.user.findMany({ where: { id: { in: ownerIds }, deletedAt: null }, select: personFields }) : Promise.resolve([]),
      ]);
      return {
        totals: totals.map((t) => ({ projectId: t.projectId, total: t._count._all, lastTaskUpdate: t._max.updatedAt ?? null })),
        openByDue: openByDue.map((g) => ({ projectId: g.projectId, dueDate: g.dueDate, count: g._count._all })),
        waitingByDue: waitingByDue.map((g) => ({ projectId: g.projectId, dueDate: g.dueDate, count: g._count._all })),
        members: members.map((m) => ({ projectId: m.projectId, person: toPerson(m.user) })),
        owners: owners.map(toPerson),
      };
    },
  };
}
