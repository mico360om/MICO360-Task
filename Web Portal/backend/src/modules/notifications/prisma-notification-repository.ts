import { Prisma, type PrismaClient, type Notification } from '@prisma/client';
import type { NotificationListOptions, NotificationRepository, NotificationScope } from './notification-repository';
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
    projectId: n.projectId,
  };
}

/**
 * 1.22: a page of the Notifications page — the Unread tab, the type chips, and the rows older than
 * the previous page's last one (newest first by time, then id, so rows of the same moment are
 * neither skipped nor repeated). Kept apart from the companies scope (`inScope`), which is ANDed on.
 */
const pageWhere = (opts: NotificationListOptions): Prisma.NotificationWhereInput => ({
  ...(opts.unreadOnly ? { readAt: null } : {}),
  ...(opts.types ? { type: { in: [...opts.types] } } : {}),
  ...(opts.before ? { AND: [{ OR: [{ createdAt: { lt: opts.before.createdAt } }, { createdAt: opts.before.createdAt, id: { lt: opts.before.id } }] }] } : {}),
});

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
    async list(userId, scope, opts = {}) {
      const ns = await prisma.notification.findMany({ where: { userId, ...inScope(scope), ...pageWhere(opts) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: opts.limit ?? 100 });
      return ns.map(toRecord);
    },
    async markRead(id) {
      return toRecord(await prisma.notification.update({ where: { id }, data: { readAt: new Date() } }));
    },
    async markAllRead(userId, upTo, scope, types) {
      await prisma.notification.updateMany({ where: { userId, readAt: null, ...(upTo ? { createdAt: { lte: upTo } } : {}), ...(types ? { type: { in: [...types] } } : {}), ...inScope(scope) }, data: { readAt: new Date() } });
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
    async unreadByType(userId, scope) {
      const groups = await prisma.notification.groupBy({ by: ['type'], where: { userId, readAt: null, ...inScope(scope) }, _count: { _all: true } });
      return Object.fromEntries(groups.map((g) => [g.type, g._count._all]));
    },
    async markUnread(id) {
      return toRecord(await prisma.notification.update({ where: { id }, data: { readAt: null } }));
    },
    async remove(id) {
      await prisma.notification.delete({ where: { id } });
    },
    async bulk(userId, ids, action) {
      const where: Prisma.NotificationWhereInput = { userId, id: { in: [...ids] } };
      if (action === 'remove') return (await prisma.notification.deleteMany({ where })).count;
      // Read: the unread ones (a read one keeps when it was read); unread: the read ones.
      if (action === 'read') return (await prisma.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } })).count;
      return (await prisma.notification.updateMany({ where: { ...where, readAt: { not: null } }, data: { readAt: null } })).count;
    },
    async projectLooks(ids) {
      // A project in the trash is named nowhere else: its old notices show no project either.
      return prisma.project.findMany({ where: { id: { in: [...ids] }, deletedAt: null }, select: { id: true, name: true, color: true, icon: true, imageUrl: true } });
    },
    async taskKeys(ids) {
      // 1.22.3: the number a task has now (a moved one's new number); one in the trash — or in a project
      // in the trash, as projectLooks — shows none.
      return prisma.task.findMany({ where: { id: { in: [...ids] }, deletedAt: null, project: { deletedAt: null } }, select: { id: true, key: true, projectId: true } });
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

/**
 * Drop reminder markers older than `days` (only the current period's markers matter) to bound the table.
 * Notification & Scheduling centre: the planner's markers (`np:`) say a once-only step was sent, so they
 * are kept a year.
 */
export async function pruneReminderLog(prisma: PrismaClient, days = 35, plannerDays = 400): Promise<void> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await prisma.reminderLog.deleteMany({ where: { createdAt: { lt: cutoff }, NOT: { dedupeKey: { startsWith: 'np:' } } } });
  await prisma.reminderLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - plannerDays * 24 * 60 * 60 * 1000) }, dedupeKey: { startsWith: 'np:' } } });
}
