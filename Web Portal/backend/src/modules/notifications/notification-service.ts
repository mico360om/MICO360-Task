import { NotFoundError } from '../../lib/http-errors';
import type { Logger } from '../../lib/logger';
import type { CreateNotificationData, NotificationRecord, NotificationRepository } from './notification-repository';
import {
  emptyPreferences,
  isMuted,
  normalizePreferences,
  type NotificationPreferences,
  type PreferenceStore,
} from './notification-preferences';

/** The slice of the push sender notify() needs (a phone push per delivered notification). */
export interface NotificationPush {
  sendToUser(
    userId: string,
    notification: { title: string; body?: string | null; entityType?: string | null; entityId?: string | null },
  ): Promise<number>;
}

export interface NotificationServiceDeps {
  notifications: NotificationRepository;
  /** Optional per-user preference store; when present, muted types are not delivered. */
  preferences?: PreferenceStore;
  /** Optional phone push (FCM). Best-effort: it never delays or fails the in-app notification. */
  push?: NotificationPush;
  /** Where failed pushes are reported. */
  logger?: Pick<Logger, 'error'>;
}

export function createNotificationService({ notifications, preferences, push, logger }: NotificationServiceDeps) {
  /** Create a notification unless the recipient has muted this type. Returns null when suppressed. */
  async function notify(input: CreateNotificationData): Promise<NotificationRecord | null> {
    if (preferences) {
      const prefs = await preferences.get(input.userId);
      if (isMuted(prefs, input.type)) return null;
    }
    const record = await notifications.create(input);
    // Muted types never reach the phone either — the push goes out only for a stored notification.
    if (push) {
      push
        .sendToUser(input.userId, { title: input.title, body: input.body ?? null, entityType: input.entityType ?? null, entityId: input.entityId ?? null })
        .catch((err) => logger?.error('push notification failed', { err, userId: input.userId, type: input.type }));
    }
    return record;
  }

  async function listForUser(userId: string): Promise<NotificationRecord[]> {
    return notifications.list(userId);
  }

  async function unreadCount(userId: string): Promise<number> {
    return notifications.unreadCount(userId);
  }

  async function markRead(id: string, userId: string): Promise<NotificationRecord> {
    const n = await notifications.findById(id);
    if (!n || n.userId !== userId) throw new NotFoundError('Notification not found.');
    return notifications.markRead(id);
  }

  async function markAllRead(userId: string): Promise<void> {
    await notifications.markAllRead(userId);
  }

  async function getPreferences(userId: string): Promise<NotificationPreferences> {
    return preferences ? preferences.get(userId) : emptyPreferences();
  }

  async function setPreferences(userId: string, input: unknown): Promise<NotificationPreferences> {
    const prefs = normalizePreferences(input);
    return preferences ? preferences.set(userId, prefs) : prefs;
  }

  return { notify, listForUser, unreadCount, markRead, markAllRead, getPreferences, setPreferences };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
