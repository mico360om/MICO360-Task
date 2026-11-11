import type { PrismaClient } from '@prisma/client';
import { managedVisibleWhere } from '../projects/project-managers';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';
import type { ProjectAccess } from '../projects/project-access';
import type { ProjectAuthz } from '../projects/project-authz';
import type { KpiAccess } from './kpi-service';

const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;

/**
 * Who may see which KPIs, over the database — the site's own rules: a project's view and manage checks
 * (project-access, project-authz), "runs a project" = owner, named manager or MANAGER member who can see
 * it (managedVisibleWhere), and a person = a staff account that isn't deleted (a client account is never
 * a person here; guests are not accounts at all).
 */
export function createPrismaKpiAccess(prisma: PrismaClient, deps: { projectAccess: ProjectAccess; projectAuthz: ProjectAuthz }): KpiAccess {
  return {
    canManageProject: (userId, roles, projectId) => deps.projectAuthz.canManageProject(userId, roles, projectId),
    async visibleProjectIds(viewer) {
      // The person's OWN work: "Show my projects only" never narrows it (as My Tasks).
      if (deps.projectAccess.ownProjectIds) return deps.projectAccess.ownProjectIds(viewer.id, viewer.roles, null);
      return deps.projectAccess.accessibleProjectIds(viewer.id, viewer.roles);
    },
    async runProjectIds(userId) {
      return (await prisma.project.findMany({ where: { deletedAt: null, ...managedVisibleWhere(userId) }, select: { id: true } })).map((p) => p.id);
    },
    async personProjectIds(userId) {
      const rows = await prisma.project.findMany({
        where: {
          deletedAt: null,
          OR: [{ ownerId: userId }, { managerId: userId }, { members: { some: { userId } } }, { tasks: { some: { deletedAt: null, assignees: { some: { userId } } } } }],
        },
        select: { id: true },
      });
      return rows.map((p) => p.id);
    },
    async person(userId) {
      const u = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null, ...STAFF_ONLY_WHERE },
        select: { id: true, firstName: true, lastName: true, username: true, avatarUrl: true, status: true, primaryCompanyId: true, companies: { select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }], take: 1 } },
      });
      if (!u) return null;
      return { id: u.id, name: nameOf(u), avatarUrl: u.avatarUrl, companyId: u.primaryCompanyId ?? u.companies[0]?.companyId ?? null, active: u.status === 'ACTIVE' };
    },
  };
}
