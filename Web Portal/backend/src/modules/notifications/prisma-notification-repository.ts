import { Prisma, type PrismaClient, type Notification } from '@prisma/client';
import type { NotificationRepository, NotificationScope } from './notification-repository';
import { normalizePreferences, type NotificationPreferences, type PreferenceStore } from './notification-preferences';
import type { ReminderLogStore } from './reminder-dispatch';

function toRecord(n: Notification) {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    entityType: n.entityType,
    entityId: n.entityId,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

/** companies: a list's rows — those about no project, and those about the projects in scope (null = all). */
const inScope = (scope?: NotificationScope): Prisma.NotificationWhereInput => (scope ? { OR: [{ projectId: null }, { projectId: { in: [...scope] } }] } : {});

/**
 * companies: the project a new notification is about, from its entity — the same rule the upgrade
 * used for the old rows: a task's project, a project, a project channel's project; else none.
 */
async function projectOfEntity(prisma: PrismaClient, entityType: string | null | undefined, entityId: string | null | undefined): Promise<string | null> {
  if (!entityType || !entityId) return null;
  if (entityType === 'task') return (await prisma.task.findUnique({ where: { id: entityId }, select: { projectId: true } }))?.projectId ?? null;
  if (entityType === 'project') return (await prisma.project.findUnique({ where: { id: entityId }, select: { id: true } }))?.id ?? null;
  if (entityType === 'conversation') return (await prisma.conversation.findUnique({ where: { id: entityId }, select: { projectId: true } }))?.projectId ?? null;
  return null;
}

export function createPrismaNotificationRepository(prisma: PrismaClient): NotificationRepository {
  return {
    async create(data) {
      const projectId = data.projectId !== undefined ? data.projectId : await projectOfEntity(prisma, data.entityType, data.entityId);
      return toRecord(
        await prisma.notification.create({
          data: {
            userId: data.userId,
            type: data.type,
            title: data.title,
            body: data.body ?? undefined,
            entityType: data.entityType ?? undefined,
            entityId: data.entityId ?? undefined,
            projectId: projectId ?? undefined,
          },
        }),
      );
    },
    async findById(id) {
      const n = await prisma.notification.findUnique({ where: { id } });
      return n ? toRecord(n) : null;
    },
    async list(userId, scope) {
      const ns = await prisma.notification.findMany({ where: { userId, ...inScope(scope) }, orderBy: { createdAt: 'desc' }, take: 100 });
      return ns.map(toRecord);
    },
    async markRead(id) {
      return toRecord(await prisma.notification.update({ where: { id }, data: { readAt: new Date() } }));
    },
    async markAllRead(userId, upTo, scope) {
      await prisma.notification.updateMany({ where: { userId, readAt: null, ...(upTo ? { createdAt: { lte: upTo } } : {}), ...inScope(scope) }, data: { readAt: new Date() } });
    },
    async unreadCount(userId, scope) {
      return prisma.notification.count({ where: { userId, readAt: null, ...inScope(scope) } });
    },
    async findUnread(userId, type, entityType, entityId) {
      const n = await prisma.notification.findFirst({ where: { userId, type, entityType, entityId, readAt: null }, orderBy: { createdAt: 'desc' } });
      return n ? toRecord(n) : null;
    },
    async refresh(id, data) {
      return toRecord(await prisma.notification.update({ where: { id }, data: { title: data.title, body: data.body ?? null, createdAt: new Date() } }));
    },
    async markEntityRead(userId, entityType, entityId) {
      const { count } = await prisma.notification.updateMany({ where: { userId, entityType, entityId, readAt: null }, data: { readAt: new Date() } });
      return count;
    },
  };
}

/** Per-user notification preferences persisted on User.notificationPrefs (JSON). */
export function createPrismaPreferenceStore(prisma: PrismaClient): PreferenceStore {
  return {
    async get(userId): Promise<NotificationPreferences> {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
      return normalizePreferences(u?.notificationPrefs ?? null);
    },
    async set(userId, prefs): Promise<NotificationPreferences> {
      await prisma.user.update({ where: { id: userId }, data: { notificationPrefs: prefs as unknown as Prisma.InputJsonValue } });
      return prefs;
    },
  };
}

/**
 * Persisted reminder idempotency markers (table `reminder_logs`). Survives restarts and is shared
 * across instances, so a redeploy never re-sends still-due reminders. `add` is an upsert so a race
 * between two instances can't throw on the unique `dedupeKey`.
 */
export function createPrismaReminderLogStore(prisma: PrismaClient): ReminderLogStore {
  return {
    async has(dedupeKey) {
      return (await prisma.reminderLog.count({ where: { dedupeKey } })) > 0;
    },
    async add(dedupeKey) {
      await prisma.reminderLog.upsert({ where: { dedupeKey }, create: { dedupeKey }, update: {} });
    },
  };
}

/** Drop reminder markers older than `days` (only the current period's markers matter) to bound the table. */
export async function pruneReminderLog(prisma: PrismaClient, days = 35): Promise<void> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await prisma.reminderLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
