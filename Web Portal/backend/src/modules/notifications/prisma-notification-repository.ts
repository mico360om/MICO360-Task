import { Prisma, type PrismaClient, type Notification } from '@prisma/client';
import type { NotificationRepository } from './notification-repository';
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

export function createPrismaNotificationRepository(prisma: PrismaClient): NotificationRepository {
  return {
    async create(data) {
      return toRecord(
        await prisma.notification.create({
          data: {
            userId: data.userId,
            type: data.type,
            title: data.title,
            body: data.body ?? undefined,
            entityType: data.entityType ?? undefined,
            entityId: data.entityId ?? undefined,
          },
        }),
      );
    },
    async findById(id) {
      const n = await prisma.notification.findUnique({ where: { id } });
      return n ? toRecord(n) : null;
    },
    async list(userId) {
      const ns = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
      return ns.map(toRecord);
    },
    async markRead(id) {
      return toRecord(await prisma.notification.update({ where: { id }, data: { readAt: new Date() } }));
    },
    async markAllRead(userId) {
      await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    },
    async unreadCount(userId) {
      return prisma.notification.count({ where: { userId, readAt: null } });
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
