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
      if (projectIds.length === 0) return { totals: [], openByDue: [], members: [], owners: [] };
      const inProjects = { deletedAt: null, projectId: { in: projectIds } };
      const [totals, openByDue, members, owners] = await Promise.all([
        prisma.task.groupBy({ by: ['projectId'], where: inProjects, _count: { _all: true }, _max: { updatedAt: true } }),
        // Open = the shared "not done" rule: not in a Done column and no completion time.
        prisma.task.groupBy({
          by: ['projectId', 'dueDate'],
          where: { ...inProjects, completedAt: null, column: { category: { not: 'DONE' } } },
          _count: { _all: true },
        }),
        prisma.projectMember.findMany({
          where: { projectId: { in: projectIds }, user: { deletedAt: null } },
          select: { projectId: true, user: { select: personFields } },
          orderBy: { addedAt: 'asc' },
        }),
        ownerIds.length ? prisma.user.findMany({ where: { id: { in: ownerIds }, deletedAt: null }, select: personFields }) : Promise.resolve([]),
      ]);
      return {
        totals: totals.map((t) => ({ projectId: t.projectId, total: t._count._all, lastTaskUpdate: t._max.updatedAt ?? null })),
        openByDue: openByDue.map((g) => ({ projectId: g.projectId, dueDate: g.dueDate, count: g._count._all })),
        members: members.map((m) => ({ projectId: m.projectId, person: toPerson(m.user) })),
        owners: owners.map(toPerson),
      };
    },
  };
}
