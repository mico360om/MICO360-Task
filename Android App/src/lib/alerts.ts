import { isNetworkError } from './api-client';
import type { QueuedMutation } from './sync-queue';
import type { KeyRefresh } from './refresh';
import type { ApiNotification } from './types';

/**
 * Alerts (the app's notifications) and the one badge rule (5c). Pure, so it is tested here.
 *
 * **The badge rule.** The number is the server's unread notifications (`/notifications/unread-count`),
 * the same number as the website's bell. Every push this phone gets is one of those notifications
 * (the server sends a push only for a notification it stored), and a chat conversation's
 * notifications are marked read by the server when the conversation is opened. So:
 *
 * - the Alerts tab shows the number, as the bell does: nothing at none, "99+" over 99;
 * - the app's icon shows the same number where the phone's launcher draws numbers, set from the
 *   server's answer (a push never sets it by itself: `shouldSetBadge` stays false);
 * - when the number drops to none everything has been read, so the app's notifications are taken
 *   off the phone's notification list too (on Android, clearing the icon's number does that);
 * - an alert is read when it is opened — from the Alerts list (as on the website), or by tapping
 *   its push on the phone (the newest unread alert about that thing, alertForPush) — or with
 *   "Mark all read";
 * - opening an alert in the app takes the phone's notifications about the same thing off the list
 *   (the chat does the same for a conversation once it is read);
 * - the number is asked for again when a push comes in, when the app comes back to the front, and
 *   every 30 s while it is in front (the website's bell asks every 30 s); signing out clears it.
 * - The Chat tab's own number (unread messages) is the chat's; it is not added to this one.
 */

/** How often the unread count is asked for while the app is in front (the website's bell: 30 s). */
export const ALERTS_POLL_MS = 30_000;

/**
 * What is asked for again on a push and on coming back to the app: the list and the count — not
 * the notification settings, which live under the same first key.
 */
export const ALERTS_REFRESH: KeyRefresh[] = [
  { queryKey: ['notifications'], exact: true },
  { queryKey: ['notifications', 'unread'], exact: true },
];

/** How long after a push an answer of "none unread" isn't trusted to clear the icon (it may be older). */
const PUSH_QUIET_MS = 10_000;

/**
 * The app icon's number for the whole run of the app: set from each count the server gives (once
 * per change, see launcherBadgeStep), and cleared at sign-out. `set` is the phone's (expo-
 * notifications' setBadgeCountAsync); a phone that can't draw numbers just says no.
 */
export function createLauncherBadge({ set, now = Date.now }: { set: (n: number) => Promise<unknown>; now?: () => number }) {
  let shown: number | null = null;
  let lastPush = Number.NEGATIVE_INFINITY;
  const apply = (n: number) => {
    shown = n;
    void set(n).catch(() => {});
  };
  return {
    /** A push came in: a count of none just after it may be older than the push. */
    pushArrived(): void {
      lastPush = now();
    },
    /** The server's unread count (undefined while not known). */
    count(next: number | null | undefined): void {
      const step = launcherBadgeStep({ shown, next, pushJustArrived: now() - lastPush < PUSH_QUIET_MS });
      if (step !== null) apply(step);
    },
    /** Sign-out: no number, and the app's notifications off the phone's list. */
    clear(): void {
      apply(0);
    },
  };
}

/** The number on the Alerts tab: none at 0, the count up to 99, then "99+" (the website's bell). */
export function alertsBadge(count: number | null | undefined): number | string | undefined {
  if (!count || count <= 0) return undefined;
  return count > 99 ? '99+' : count;
}

/** What TalkBack reads for the Alerts tab, like the bell's "Notifications, 3 unread". */
export function alertsTabLabel(count: number | null | undefined): string {
  return count && count > 0 ? `Alerts, ${count} unread` : 'Alerts';
}

/**
 * The number to put on the app's icon now, or null to leave it: set only when it changed, never
 * while the count isn't known, and not cleared by an answer that may be older than a push that
 * just came in (clearing also takes the app's notifications off the phone — never the new one).
 */
export function launcherBadgeStep({
  shown,
  next,
  pushJustArrived = false,
}: {
  /** The number this run of the app last set (null: none set yet). */
  shown: number | null;
  /** The server's unread count (undefined/null: not known). */
  next: number | null | undefined;
  pushJustArrived?: boolean;
}): number | null {
  if (next === null || next === undefined || Number.isNaN(next)) return null;
  const n = Math.max(0, Math.floor(next));
  if (n === shown) return null;
  if (n === 0 && pushJustArrived) return null;
  return n;
}

/** The list with one alert read, at once (the same list when there is nothing to change). */
export function markedRead(list: ApiNotification[] | undefined, id: string, readAt: string): ApiNotification[] | undefined {
  if (!list || !list.some((x) => x.id === id && !x.readAt)) return list;
  return list.map((x) => (x.id === id && !x.readAt ? { ...x, readAt } : x));
}

/** The list with every alert read ("Mark all read" done), keeping when the read ones were read. */
export function allRead(list: ApiNotification[] | undefined, readAt: string): ApiNotification[] | undefined {
  return list?.map((x) => (x.readAt ? x : { ...x, readAt }));
}

/**
 * The alert a push opened from the phone's notification list was for: the newest unread one about
 * the same thing (the push names the thing, not the alert; the list is newest first). Opening it
 * reads it, as clicking it on the website does. Null when there is none to read.
 */
export function alertForPush(list: readonly ApiNotification[] | null | undefined, data: Record<string, unknown>): ApiNotification | null {
  const type = typeof data.entityType === 'string' ? data.entityType.trim().toLowerCase() : '';
  const id = typeof data.entityId === 'string' ? data.entityId : '';
  if (!list || !type || !id) return null;
  return list.find((x) => !x.readAt && (x.entityType ?? '').toLowerCase() === type && x.entityId === id) ?? null;
}

/** The unread count after reading one alert. */
export function countAfterRead(count: number | undefined, wasUnread: boolean): number | undefined {
  if (count === undefined) return undefined;
  return wasUnread ? Math.max(0, count - 1) : count;
}

/**
 * The list with this phone's reads still waiting to be sent (kept offline, `notification.read`)
 * shown as read: neither the server nor the offline copy has them yet. The same list when none apply.
 */
export function withPendingReads(
  list: ApiNotification[],
  pending: readonly Pick<QueuedMutation, 'kind' | 'payload' | 'createdAt'>[],
): ApiNotification[] {
  const readAt = new Map<string, string>();
  for (const m of pending) {
    if (m.kind !== 'notification.read') continue;
    const id = (m.payload as { id?: unknown } | null)?.id;
    if (typeof id === 'string') readAt.set(id, new Date(m.createdAt).toISOString());
  }
  if (readAt.size === 0 || !Array.isArray(list) || !list.some((x) => !x.readAt && readAt.has(x.id))) return list;
  return list.map((x) => (!x.readAt && readAt.has(x.id) ? { ...x, readAt: readAt.get(x.id)! } : x));
}

/** A notification shown on the phone, as expo-notifications lists them. */
export interface PresentedNotification {
  request: { identifier: string; content: { data?: Record<string, unknown> | null } };
}

/** The ids of the phone's notifications about one thing (its entityType and entityId). */
export function trayIdsAbout(presented: readonly PresentedNotification[], entityType: string, entityId: string): string[] {
  const type = entityType.trim().toLowerCase();
  if (!type || !entityId) return [];
  return presented
    .filter((p) => {
      const d = (p.request.content.data ?? {}) as { entityType?: unknown; entityId?: unknown };
      return typeof d.entityType === 'string' && d.entityType.trim().toLowerCase() === type && d.entityId === entityId;
    })
    .map((p) => p.request.identifier);
}

/**
 * Why "Mark all read" didn't happen. It isn't kept for later like reading one alert: sent later,
 * it would also mark alerts that came in meanwhile and were never seen.
 */
export function markAllProblem(error: unknown): string {
  return isNetworkError(error)
    ? 'Marking all as read needs a connection. Try again when you’re back online.'
    : 'Couldn’t mark everything as read. Please try again.';
}
