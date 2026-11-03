import type { PrismaClient, Prisma } from '@prisma/client';
import type { ActivityRecord, ActivityRepository, ActivityScope, CreateActivityData } from './activity-repository';

// Join the actor + task + project so the feed reads as "who did what to which task" (no N+1).
const withContext = {
  user: { select: { id: true, username: true, firstName: true, lastName: true } },
  task: { select: { id: true, key: true, title: true } },
  project: { select: { id: true, name: true } },
} as const;

type Row = Prisma.ActivityGetPayload<{ include: typeof withContext }>;
const displayName = (u: { firstName: string | null; lastName: string | null; username: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

function toRecord(a: Row): ActivityRecord {
  return {
    id: a.id,
    taskId: a.taskId,
    projectId: a.projectId,
    userId: a.userId,
    action: a.action,
    meta: a.meta,
    createdAt: a.createdAt,
    actor: a.user ? { id: a.user.id, name: displayName(a.user) } : null,
    task: a.task ? { id: a.task.id, key: a.task.key, title: a.task.title } : null,
    project: a.project ? { id: a.project.id, name: a.project.name } : null,
  };
}

/**
 * The rows a scope covers between two instants: in those projects (an administrator: any, or none)
 * and never in a deleted project — the same rule as the feed — and, with a filter, those actions.
 */
function between(from: Date, to: Date, scope: ActivityScope): Prisma.ActivityWhereInput {
  return {
    createdAt: { gte: from, lt: to },
    ...(scope.projectIds
      ? { projectId: { in: scope.projectIds }, project: { is: { deletedAt: null } } }
      : { OR: [{ projectId: null }, { project: { is: { deletedAt: null } } }] }),
    ...(scope.actions ? { action: { in: scope.actions } } : {}),
  };
}

export function createPrismaActivityRepository(prisma: PrismaClient): ActivityRepository {
  return {
    async create(data: CreateActivityData) {
      const a = await prisma.activity.create({
        data: {
          userId: data.userId,
          action: data.action,
          taskId: data.taskId ?? undefined,
          projectId: data.projectId ?? undefined,
          meta: (data.meta as Prisma.InputJsonValue) ?? undefined,
        },
      });
      return { id: a.id, taskId: a.taskId, projectId: a.projectId, userId: a.userId, action: a.action, meta: a.meta, createdAt: a.createdAt };
    },
    async listForTask(taskId) {
      const rows = await prisma.activity.findMany({ where: { taskId }, orderBy: { createdAt: 'desc' }, take: 100, include: withContext });
      return rows.map(toRecord);
    },
    async listRecent(limit, projectIds) {
      const rows = await prisma.activity.findMany({
        // Scope before the limit; a deleted project's activity drops out of the feed.
        where: projectIds
          ? { projectId: { in: projectIds }, project: { is: { deletedAt: null } } }
          : { OR: [{ projectId: null }, { project: { is: { deletedAt: null } } }] },
        orderBy: { createdAt: 'desc' },
        take: limit ?? 50,
        include: withContext,
      });
      return rows.map(toRecord);
    },
    async timesBetween(from, to, scope) {
      const rows = await prisma.activity.findMany({ where: between(from, to, scope), select: { createdAt: true } });
      return rows.map((r) => r.createdAt);
    },
    async listBetween(from, to, scope, page) {
      // Carry on after the last change shown: older, or as old with a smaller id (the order's tie-break).
      const last = page.before ? await prisma.activity.findUnique({ where: { id: page.before }, select: { id: true, createdAt: true } }) : null;
      if (page.before && !last) return [];
      const after: Prisma.ActivityWhereInput = last ? { OR: [{ createdAt: { lt: last.createdAt } }, { createdAt: last.createdAt, id: { lt: last.id } }] } : {};
      const rows = await prisma.activity.findMany({
        where: { AND: [between(from, to, scope), after] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit,
        include: withContext,
      });
      return rows.map(toRecord);
    },
  };
}
