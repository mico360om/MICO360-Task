import type { PrismaClient, Prisma } from '@prisma/client';
import type { ActivityRecord, ActivityRepository, CreateActivityData } from './activity-repository';

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
    async listRecent(limit) {
      const rows = await prisma.activity.findMany({ orderBy: { createdAt: 'desc' }, take: limit ?? 50, include: withContext });
      return rows.map(toRecord);
    },
  };
}
