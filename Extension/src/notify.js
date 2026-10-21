import { badgeText } from './chat.js';

/** Fixed id so a newer desktop notification replaces the previous one; clicks are matched on it. */
export const NOTIFICATION_ID = 'mico360-unread';

/**
 * Whether the unread count rising warrants a desktop notification (T16.5). Without a baseline
 * (first poll after install or sign-in) nothing is announced: existing unread items aren't "new".
 */
export function shouldNotify(prevCount, nextCount) {
  return typeof prevCount === 'number' && typeof nextCount === 'number' && nextCount > prevCount;
}

/** The stored unread count is only a baseline for the user it was recorded for (EXT-06). */
export function unreadBaseline(stored, userId) {
  return stored && stored.lastUnreadUser === userId && typeof stored.lastUnread === 'number' ? stored.lastUnread : undefined;
}

/** Human text for the desktop notification. */
export function notificationText(count) {
  return count === 1 ? 'You have 1 new notification' : `You have ${count} new notifications`;
}

/**
 * Find an open tab showing the extension app among `chrome.runtime.getContexts()` results, so the
 * toolbar button can focus it without the "tabs" permission (EXT-07). Returns the context or null.
 */
export function findAppContext(contexts, appUrl) {
  return (
    (contexts || []).find(
      (c) => c && typeof c.documentUrl === 'string' && c.documentUrl.split('#')[0].split('?')[0] === appUrl && typeof c.tabId === 'number' && c.tabId >= 0,
    ) || null
  );
}

/** The toolbar icon's red badge for the unread count (M7): set by the app as soon as its count changes, and by the worker's poll. */
export function setToolbarBadge(action, count) {
  try {
    action.setBadgeText({ text: badgeText(count) });
    if (count > 0) action.setBadgeBackgroundColor({ color: '#8B1E1E' });
  } catch {
    /* no toolbar action here (or the browser refused): the badge is a convenience */
  }
}

/**
 * Where clicking a notification takes the person (M7), as the web's notification links do: a task
 * opens in the task drawer, a conversation in Chat, a meeting on the website (the extension has no
 * meetings screen). Returns `{ hash }` for a screen here, `{ url }` for the website, or null.
 */
export function notificationTarget(n, appBase) {
  const type = String((n && n.entityType) || '').toLowerCase();
  const id = n && typeof n.entityId === 'string' && n.entityId ? n.entityId : null;
  if (type === 'task' && id) return { hash: `#/task/${encodeURIComponent(id)}` };
  if (type === 'conversation') return { hash: id ? `#/chat/${encodeURIComponent(id)}` : '#/chat' };
  if (type === 'meeting' && id && appBase) return { url: `${String(appBase).replace(/\/+$/, '')}/meetings/${encodeURIComponent(id)}` };
  return null;
}
