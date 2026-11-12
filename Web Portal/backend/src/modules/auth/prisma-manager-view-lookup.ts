import type { PrismaClient } from '@prisma/client';
import type { ManagerViewLookup } from './manager-view';
import { managedProjectsWhere } from '../projects/project-managers';

/**
 * Manager View's "a project they run": its owner, named manager or a MANAGER member of its team — the team
 * rule alone (project-managers), without the company condition the other manage checks add: an
 * administrator sees every company's projects without belonging to them. A deleted project is nobody's.
 */
export function createPrismaManagerViewLookup(prisma: PrismaClient): ManagerViewLookup {
  return {
    async runsProject(userId, projectId) {
      return (await prisma.project.findFirst({ where: { id: projectId, deletedAt: null, ...managedProjectsWhere(userId) }, select: { id: true } })) !== null;
    },
    async runsAmong(userId, projectIds) {
      if (projectIds.length === 0) return [];
      const rows = await prisma.project.findMany({ where: { id: { in: projectIds }, deletedAt: null, ...managedProjectsWhere(userId) }, select: { id: true } });
      return rows.map((r) => r.id);
    },
    async projectIdOfColumn(columnId) {
      return (await prisma.kanbanColumn.findUnique({ where: { id: columnId }, select: { projectId: true } }))?.projectId ?? null;
    },
  };
}
