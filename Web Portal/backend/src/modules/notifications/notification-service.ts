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
    notification: { title: string; body?: string | null; entityType?: string | null; entityId?: string | null; notificationId?: string | null },
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
    return deliver(input, false);
  }

  /**
   * Like `notify`, but keeps ONE waiting notification per thing: while an unread notification of this
   * type about the same entity exists, it is reworded and moved to the top instead of adding another.
   * Used for direct messages — ten messages in a conversation are one thing to look at, not ten.
   */
  async function notifyOnce(input: CreateNotificationData): Promise<NotificationRecord | null> {
    return deliver(input, true);
  }

  /** Mark everything about one thing as read (e.g. the user opened that conversation). */
  async function markEntityRead(userId: string, entityType: string, entityId: string): Promise<number> {
    return notifications.markEntityRead(userId, entityType, entityId);
  }

  /**
   * notifyOnce calls in flight, per (user, type, thing). Two messages from one sender arrive within a
   * few milliseconds (a double Enter, a message with its file): the second must see the first one's
   * row, or both find "nothing waiting" and the reader gets two notifications for one conversation.
   */
  const inFlight = new Map<string, Promise<NotificationRecord | null>>();

  async function deliver(input: CreateNotificationData, once: boolean): Promise<NotificationRecord | null> {
    if (!once || !input.entityType || !input.entityId) return deliverNow(input, once);
    const key = `${input.userId}|${input.type}|${input.entityType}|${input.entityId}`;
    const previous = inFlight.get(key) ?? Promise.resolve(null);
    const run = previous.then(
      () => deliverNow(input, true),
      () => deliverNow(input, true),
    );
    inFlight.set(key, run);
    try {
      return await run;
    } finally {
      if (inFlight.get(key) === run) inFlight.delete(key);
    }
  }

  async function deliverNow(input: CreateNotificationData, once: boolean): Promise<NotificationRecord | null> {
    if (preferences) {
      const prefs = await preferences.get(input.userId);
      if (isMuted(prefs, input.type)) return null;
    }
    const waiting = once && input.entityType && input.entityId ? await notifications.findUnread(input.userId, input.type, input.entityType, input.entityId) : null;
    const record = waiting ? await notifications.refresh(waiting.id, { title: input.title, body: input.body ?? null }) : await notifications.create(input);
    // Muted types never reach the phone either — the push goes out only for a stored notification.
    if (push) {
      push
        // The stored notification's id: a tap on the phone reads exactly this one (5c review).
        .sendToUser(input.userId, { title: input.title, body: input.body ?? null, entityType: input.entityType ?? null, entityId: input.entityId ?? null, notificationId: record.id })
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

  /** Read everything — with `upTo`, only what came in by then (newer ones were never seen). */
  async function markAllRead(userId: string, upTo?: Date): Promise<void> {
    await notifications.markAllRead(userId, upTo);
  }

  async function getPreferences(userId: string): Promise<NotificationPreferences> {
    return preferences ? preferences.get(userId) : emptyPreferences();
  }

  async function setPreferences(userId: string, input: unknown): Promise<NotificationPreferences> {
    const prefs = normalizePreferences(input);
    return preferences ? preferences.set(userId, prefs) : prefs;
  }

  return { notify, notifyOnce, markEntityRead, listForUser, unreadCount, markRead, markAllRead, getPreferences, setPreferences };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
