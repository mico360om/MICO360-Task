import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type { Logger } from '../../lib/logger';
import type { CreateNotificationData, ListScope, NotificationBulkAction, NotificationProject, NotificationRecord, NotificationRepository } from './notification-repository';
import { decodeNotificationCursor, encodeNotificationCursor, typesOfKinds, unreadByKind, type NotificationCounts, type NotificationKind } from './notification-kinds';
import {
  emptyPreferences,
  isMuted,
  normalizePreferences,
  type NotificationPreferences,
  type PreferenceStore,
} from './notification-preferences';

/** How the phone push of one notification is shown (see PushDeliveryOptions): its channel, how long it lasts, its tag. */
export interface NotificationPushOptions {
  channelId?: string;
  ttlSeconds?: number;
  tag?: string;
}

/** The slice of the push sender notify() needs (a phone push per delivered notification). */
export interface NotificationPush {
  sendToUser(
    userId: string,
    notification: { title: string; body?: string | null; entityType?: string | null; entityId?: string | null; notificationId?: string | null } & NotificationPushOptions,
  ): Promise<number>;
}

/** A row of the list as the apps get it (1.22): with the project it is about, when it has one. */
/** 1.22.3: `taskKey` — the current number of the task a notice is about (null for any other notice). */
export type NotificationView = NotificationRecord & { projectId: string | null; project: NotificationProject | null; taskKey: string | null };

/** What a page of the list asks for (1.22). */
export interface NotificationPageQuery {
  /** The previous page's `nextCursor`; none = from the newest. */
  cursor?: string;
  /** How many (default 100: the bell, the phone app and the extension ask for no limit). */
  limit?: number;
  /** The Unread tab. */
  unread?: boolean;
  /** The type chips; none = every type. */
  kinds?: NotificationKind[];
}

/** At most this many in one "several at once" request. */
export const MAX_BULK_NOTIFICATIONS = 200;

export interface NotifyOptions {
  /** How the phone push is shown (meeting reminders: their own channel, out of date at the start). */
  push?: NotificationPushOptions;
}

export interface NotificationServiceDeps {
  notifications: NotificationRepository;
  /** Optional per-user preference store; when present, muted types are not delivered. */
  preferences?: PreferenceStore;
  /** Optional phone push (FCM). Best-effort: it never delays or fails the in-app notification. */
  push?: NotificationPush;
  /** Where failed pushes are reported. */
  logger?: Pick<Logger, 'error'>;
  /** Each stored notification, for the person's open pages (the website's live pop-up). Best-effort. */
  onDelivered?: (record: NotificationRecord) => void;
}

export function createNotificationService({ notifications, preferences, push, logger, onDelivered }: NotificationServiceDeps) {
  /** Create a notification unless the recipient has muted this type. Returns null when suppressed. */
  async function notify(input: CreateNotificationData, opts?: NotifyOptions): Promise<NotificationRecord | null> {
    return deliver(input, false, opts);
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

  async function deliver(input: CreateNotificationData, once: boolean, opts?: NotifyOptions): Promise<NotificationRecord | null> {
    if (!once || !input.entityType || !input.entityId) return deliverNow(input, once, opts);
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

  async function deliverNow(input: CreateNotificationData, once: boolean, opts?: NotifyOptions): Promise<NotificationRecord | null> {
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
        .sendToUser(input.userId, {
          title: input.title,
          body: input.body ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          notificationId: record.id,
          ...opts?.push,
        })
        .catch((err) => logger?.error('push notification failed', { err, userId: input.userId, type: input.type }));
    }
    try {
      onDelivered?.(record);
    } catch (err) {
      logger?.error('live notification failed', { err, userId: input.userId, type: input.type });
    }
    return record;
  }

  /** companies: `scope` limits the list to rows about no project or about its projects (the bell's company filter). */
  async function listForUser(userId: string, scope?: ListScope): Promise<NotificationRecord[]> {
    return notifications.list(userId, scope?.projectIds ?? null);
  }

  async function unreadCount(userId: string, scope?: ListScope): Promise<number> {
    return notifications.unreadCount(userId, scope?.projectIds ?? null);
  }

  async function markRead(id: string, userId: string): Promise<NotificationRecord> {
    const n = await notifications.findById(id);
    if (!n || n.userId !== userId) throw new NotFoundError('Notification not found.');
    return notifications.markRead(id);
  }

  /**
   * Read everything — with `upTo`, only what came in by then (newer ones were never seen); with
   * `scope`, only what the list showed; with `kinds` (the page's chips), only those types.
   */
  async function markAllRead(userId: string, upTo?: Date, scope?: ListScope, kinds?: NotificationKind[]): Promise<void> {
    const types = typesOfKinds(kinds);
    if (types) await notifications.markAllRead(userId, upTo, scope?.projectIds ?? null, types);
    else await notifications.markAllRead(userId, upTo, scope?.projectIds ?? null);
  }

  /**
   * One page of the list (1.22): newest first, after the cursor's row, of the Unread tab and the
   * chips, in `scope` (the companies rule, unchanged). `nextCursor` is null when nothing is older.
   */
  async function listPage(userId: string, scope?: ListScope, query: NotificationPageQuery = {}): Promise<{ data: NotificationView[]; nextCursor: string | null }> {
    const before = decodeNotificationCursor(query.cursor);
    const limit = query.limit ?? 100;
    const types = typesOfKinds(query.kinds);
    const rows = await notifications.list(userId, scope?.projectIds ?? null, {
      ...(before ? { before } : {}),
      limit: limit + 1,
      ...(query.unread ? { unreadOnly: true } : {}),
      ...(types ? { types } : {}),
    });
    const page = rows.slice(0, limit);
    const projectIds = [...new Set(page.map((n) => n.projectId).filter((id): id is string => !!id))];
    const looks = new Map((projectIds.length ? await notifications.projectLooks(projectIds) : []).map((p) => [p.id, p]));
    // 1.22.3: each task notice names the task's number now — the website shows it as the chip, so a
    // notice made before 1.22.3, or before the task moved, shows the right one. Never the number of a
    // task now in a project outside the reader's scope — nor (1.22.3 review) of one the reader may not
    // open: the scope is their whole company, a task moved to a project of it they aren't on isn't theirs.
    const taskIds = [...new Set(page.filter((n) => n.entityType === 'task' && n.entityId).map((n) => n.entityId!))];
    const inScope = scope?.projectIds ? new Set(scope.projectIds) : null;
    const openable = scope?.taskProjectIds ? new Set(scope.taskProjectIds) : null;
    const keys = new Map(
      (taskIds.length ? await notifications.taskKeys(taskIds) : [])
        .filter((t) => (!inScope || inScope.has(t.projectId)) && (!openable || openable.has(t.projectId)))
        .map((t) => [t.id, t.key]),
    );
    const last = page[page.length - 1];
    return {
      data: page.map((n) => ({
        ...n,
        projectId: n.projectId ?? null,
        project: (n.projectId && looks.get(n.projectId)) || null,
        taskKey: (n.entityType === 'task' && n.entityId && keys.get(n.entityId)) || null,
      })),
      nextCursor: rows.length > limit && last ? encodeNotificationCursor(last) : null,
    };
  }

  /** Unread ones per chip and in all (the bell's badge number), in `scope`. */
  async function counts(userId: string, scope?: ListScope): Promise<NotificationCounts> {
    return unreadByKind(await notifications.unreadByType(userId, scope?.projectIds ?? null));
  }

  async function ownOne(id: string, userId: string): Promise<NotificationRecord> {
    const n = await notifications.findById(id);
    if (!n || n.userId !== userId) throw new NotFoundError('Notification not found.');
    return n;
  }

  async function markUnread(id: string, userId: string): Promise<NotificationRecord> {
    await ownOne(id, userId);
    return notifications.markUnread(id);
  }

  /** Gone for that person (the row is deleted). */
  async function remove(id: string, userId: string): Promise<void> {
    await ownOne(id, userId);
    await notifications.remove(id);
  }

  /** Read, unread or remove several at once: the caller's own ones among `ids` (others are skipped), at most 200. */
  async function bulk(userId: string, ids: readonly string[], action: NotificationBulkAction): Promise<{ count: number }> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new ValidationError('Choose at least one notification.');
    if (unique.length > MAX_BULK_NOTIFICATIONS) throw new ValidationError(`Choose at most ${MAX_BULK_NOTIFICATIONS} notifications at a time.`);
    return { count: await notifications.bulk(userId, unique, action) };
  }

  async function getPreferences(userId: string): Promise<NotificationPreferences> {
    return preferences ? preferences.get(userId) : emptyPreferences();
  }

  async function setPreferences(userId: string, input: unknown): Promise<NotificationPreferences> {
    const prefs = normalizePreferences(input);
    return preferences ? preferences.set(userId, prefs) : prefs;
  }

  return { notify, notifyOnce, markEntityRead, listForUser, listPage, counts, unreadCount, markRead, markUnread, remove, bulk, markAllRead, getPreferences, setPreferences };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
