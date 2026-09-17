import { NotFoundError } from '../../lib/http-errors';
import type { CreateNotificationData, NotificationRecord, NotificationRepository } from './notification-repository';
import {
  emptyPreferences,
  isMuted,
  normalizePreferences,
  type NotificationPreferences,
  type PreferenceStore,
} from './notification-preferences';

export interface NotificationServiceDeps {
  notifications: NotificationRepository;
  /** Optional per-user preference store; when present, muted types are not delivered. */
  preferences?: PreferenceStore;
}

export function createNotificationService({ notifications, preferences }: NotificationServiceDeps) {
  /** Create a notification unless the recipient has muted this type. Returns null when suppressed. */
  async function notify(input: CreateNotificationData): Promise<NotificationRecord | null> {
    if (preferences) {
      const prefs = await preferences.get(input.userId);
      if (isMuted(prefs, input.type)) return null;
    }
    return notifications.create(input);
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
