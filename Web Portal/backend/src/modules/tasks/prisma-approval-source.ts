import type { PrismaClient } from '@prisma/client';
import { managedVisibleWhere } from '../projects/project-managers';
import { sharesProjectCompanyWhere } from '../companies/company-access';
import { createPrismaTaskRepository } from './prisma-task-repository';
import type { TaskRecord } from './task-repository';
import type { ApprovalPerson, ApprovalRow, ApprovalSource, ApprovalViewer, TaskApprovalDetails } from './task-approval-routes';

const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;
const personFields = { id: true, firstName: true, lastName: true, username: true } as const;
const isAdmin = (roles: string[]) => roles.includes('ADMIN');
const active = { deletedAt: null, status: 'ACTIVE' } as const;

export interface PrismaApprovalSource extends ApprovalSource {
  /** How many tasks wait for this person's approval (the morning email's line). */
  countFor(userId: string): Promise<number>;
  /** A task's approval as its details show it to one person. */
  details(viewer: ApprovalViewer, task: TaskRecord): Promise<TaskApprovalDetails>;
  /**
   * Who is told a task waits for approval: the active people who run its project (owner, named
   * manager, MANAGER members) — else, when nobody does, the active administrators. Never `exceptId`.
   */
  approvers(projectId: string, exceptId?: string | null): Promise<string[]>;
}

/**
 * Task approvals over the database. Who may approve = `canManageProject`: administrators, and the
 * people who run the project and can see it (managedVisibleWhere — the one definition every check uses).
 */
export function createPrismaApprovalSource(prisma: PrismaClient, deps: { canManageProject: (userId: string, roles: string[], projectId: string) => Promise<boolean> }): PrismaApprovalSource {
  const tasks = createPrismaTaskRepository(prisma);

  /** The live projects whose tasks this person may approve: null = every one (an administrator). */
  async function approvable(viewer: ApprovalViewer): Promise<string[] | null> {
    if (isAdmin(viewer.roles)) return null;
    return (await prisma.project.findMany({ where: { deletedAt: null, ...managedVisibleWhere(viewer.id) }, select: { id: true } })).map((p) => p.id);
  }

  async function people(ids: (string | null | undefined)[]): Promise<Map<string, ApprovalPerson>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const rows = await prisma.user.findMany({ where: { id: { in: wanted } }, select: personFields });
    return new Map(rows.map((u) => [u.id, { id: u.id, name: nameOf(u) }]));
  }

  /** The active people who run a project and can see it (in one of its active companies). */
  async function runners(projectId: string): Promise<{ id: string; name: string }[]> {
    const p = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { ownerId: true, managerId: true, members: { where: { role: 'MANAGER' }, select: { userId: true } } },
    });
    if (!p) return [];
    const ids = [...new Set([p.ownerId, p.managerId, ...p.members.map((m) => m.userId)].filter((id): id is string => !!id))];
    if (ids.length === 0) return [];
    return (await prisma.user.findMany({ where: { id: { in: ids }, ...active, ...sharesProjectCompanyWhere(projectId) }, select: personFields })).map((u) => ({ id: u.id, name: nameOf(u) }));
  }

  async function roleNames(userId: string): Promise<string[]> {
    const u = await prisma.user.findFirst({ where: { id: userId, ...active }, select: { roles: { select: { role: { select: { name: true } } } } } });
    return u ? u.roles.map((r) => r.role.name) : [];
  }

  return {
    async list(viewer) {
      const scope = await approvable(viewer);
      if (scope && scope.length === 0) return [];
      const waiting = await tasks.list({ awaitingApproval: true, ...(scope ? { projectIds: scope } : {}) });
      if (waiting.length === 0) return [];
      const [projects, who] = await Promise.all([
        prisma.project.findMany({ where: { id: { in: [...new Set(waiting.map((t) => t.projectId))] } }, select: { id: true, code: true, name: true, color: true, icon: true, imageUrl: true } }),
        people(waiting.map((t) => t.approvalRequestedById)),
      ]);
      const byId = new Map(projects.map((p) => [p.id, p]));
      return waiting
        .filter((t) => byId.has(t.projectId))
        .sort((a, b) => (a.approvalRequestedAt?.getTime() ?? 0) - (b.approvalRequestedAt?.getTime() ?? 0) || a.key.localeCompare(b.key, undefined, { numeric: true }))
        .map((t): ApprovalRow => ({ ...t, project: byId.get(t.projectId)!, requestedBy: (t.approvalRequestedById && who.get(t.approvalRequestedById)) || null }));
    },

    async canApproveAny(viewer) {
      if (isAdmin(viewer.roles)) return true;
      return (await prisma.project.count({ where: { deletedAt: null, ...managedVisibleWhere(viewer.id) } })) > 0;
    },

    async countFor(userId) {
      const scope = await approvable({ id: userId, roles: await roleNames(userId) });
      if (scope && scope.length === 0) return 0;
      return prisma.task.count({ where: { deletedAt: null, approvalRequestedAt: { not: null }, project: { is: { deletedAt: null } }, ...(scope ? { projectId: { in: scope } } : {}) } });
    },

    async details(viewer, task) {
      const [canApprove, who, run] = await Promise.all([
        deps.canManageProject(viewer.id, viewer.roles, task.projectId),
        people([task.approvalRequestedById, task.approvedById]),
        runners(task.projectId),
      ]);
      return {
        canApprove,
        requestedBy: (task.approvalRequestedById && who.get(task.approvalRequestedById)) || null,
        approvedBy: (task.approvedById && who.get(task.approvedById)) || null,
        approverName: run.length === 1 ? run[0]!.name : null,
      };
    },

    async approvers(projectId, exceptId) {
      const run = (await runners(projectId)).map((p) => p.id).filter((id) => id !== exceptId);
      if (run.length > 0) return run;
      const admins = await prisma.user.findMany({ where: { ...active, roles: { some: { role: { name: 'ADMIN' } } } }, select: { id: true } });
      return admins.map((a) => a.id).filter((id) => id !== exceptId);
    },
  };
}
