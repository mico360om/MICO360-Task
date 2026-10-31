import type { ApiNotification } from '../api/notifications';

/** The notification type of an automatic meeting reminder (the server's MEETING_REMINDER_TYPE). */
export const MEETING_REMINDER = 'MEETING_REMINDER';

/** At most this many reminder pop-ups are on the screen at once (the newest). */
export const MAX_POPUPS = 3;

/** The server's `notification:new` payload as a notification, or null when it isn't one. */
export function readLiveNotification(payload: unknown): ApiNotification | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.type !== 'string' || typeof p.title !== 'string') return null;
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    body: typeof p.body === 'string' ? p.body : null,
    entityType: typeof p.entityType === 'string' ? p.entityType : null,
    entityId: typeof p.entityId === 'string' ? p.entityId : null,
    readAt: null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
  };
}

/**
 * The pop-ups after a new notification: a meeting reminder goes on top (replacing an older one
 * about the same meeting, and the same one sent twice); anything else changes nothing.
 */
export function popupsAfter(list: readonly ApiNotification[], n: ApiNotification): ApiNotification[] {
  if (n.type !== MEETING_REMINDER) return [...list];
  const rest = list.filter((x) => x.id !== n.id && !(n.entityId && x.entityId === n.entityId));
  return [n, ...rest].slice(0, MAX_POPUPS);
}

export function popupsWithout(list: readonly ApiNotification[], id: string): ApiNotification[] {
  return list.filter((x) => x.id !== id);
}
