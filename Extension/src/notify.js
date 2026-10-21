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

// ---- Stage 5: notification preferences and what the desktop alert says ----------------------

/** The kinds of notification someone can switch off, worded as on the web's Settings page. */
export const NOTIFICATION_TYPES = Object.freeze([
  { type: 'TASK_ASSIGNED', label: 'Task assignments', desc: 'When a task is assigned to you' },
  { type: 'TASK_STATUS', label: 'Status changes', desc: 'When one of your tasks moves column' },
  { type: 'TASK_COMMENT', label: 'Comments', desc: 'New comments on tasks you’re on' },
  { type: 'MENTION', label: 'Mentions', desc: 'When someone @mentions you' },
  { type: 'TASK_DUE_SOON', label: 'Due soon', desc: 'A reminder shortly before a task is due' },
  { type: 'TASK_OVERDUE', label: 'Overdue', desc: 'When one of your tasks becomes overdue' },
]);

/** "Remind me before due" (minutes before a task's due time); null = the workspace default. */
export const REMINDER_OPTIONS = Object.freeze([
  { label: 'Default (1 day)', value: null },
  { label: 'At due time', value: 0 },
  { label: '1 hour before', value: 60 },
  { label: '4 hours before', value: 240 },
  { label: '1 day before', value: 1440 },
  { label: '2 days before', value: 2880 },
  { label: '1 week before', value: 10080 },
]);

/** The morning emails until someone chooses otherwise (the server's defaults). */
export const DEFAULT_DAILY_EMAILS = Object.freeze({ pending: true, completed: true, time: '06:00' });

/**
 * This device's desktop alerts (chrome.storage.local): whether there are any, and whether one may
 * say what the newest notification is about — off until chosen, since anyone near the screen can
 * read it. Cleared on sign-out (session.js USER_DATA_KEYS), so the next person starts private.
 */
export const DESKTOP_ALERTS_KEY = 'desktopAlerts';
const ALERT_DEFAULTS = Object.freeze({ on: true, details: false });

export async function readAlertSettings(local) {
  try {
    const saved = ((await local.get(DESKTOP_ALERTS_KEY)) || {})[DESKTOP_ALERTS_KEY];
    return {
      on: saved && typeof saved.on === 'boolean' ? saved.on : ALERT_DEFAULTS.on,
      details: saved && typeof saved.details === 'boolean' ? saved.details : ALERT_DEFAULTS.details,
    };
  } catch {
    return { ...ALERT_DEFAULTS };
  }
}

export async function saveAlertSettings(local, patch) {
  const next = { ...(await readAlertSettings(local)), ...patch };
  await local.set({ [DESKTOP_ALERTS_KEY]: next });
  return next;
}

/**
 * Take the desktop alert off the screen (sign-out, a session that ended): it may say what the newest
 * notification was about, and it isn't the next person's. Never fails.
 */
export function clearDesktopAlert(notifications) {
  try {
    const p = notifications && typeof notifications.clear === 'function' ? notifications.clear(NOTIFICATION_ID) : null;
    if (p && typeof p.catch === 'function') p.catch(() => { /* gone already */ });
  } catch {
    /* no desktop notifications here */
  }
}

/** What the last desktop alert was about (chrome.storage.session), so a click can open it. */
export const ALERT_TARGET_KEY = 'mico360.alertTarget';

/** The newest notification not read yet, or null. */
export function newestUnread(list) {
  if (!Array.isArray(list)) return null;
  let best = null;
  for (const n of list) {
    if (!n || n.readAt) continue;
    if (!best || String(n.createdAt) > String(best.createdAt)) best = n;
  }
  return best;
}

/**
 * The desktop alert for `fresh` new notifications: how many (never the total unread), or — when it
 * may say (`details`) and the newest is known — that one's title and words, with how many more.
 */
export function alertContent({ fresh, newest, details }) {
  if (!details || !newest) return { title: 'MICO360 Tasks', message: notificationText(fresh) };
  const more = Math.max(0, fresh - 1);
  return {
    title: newest.title || 'MICO360 Tasks',
    message: newest.body || 'Click to open it.', // Chrome needs words in every alert
    contextMessage: more ? `And ${more} more new notification${more === 1 ? '' : 's'}` : 'MICO360 Tasks',
  };
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
 * opens in the task drawer, a conversation in Chat, a meeting on its page (Stage 6; its notes and
 * minutes are a click away on the website). Returns `{ hash }` for a screen here, or null.
 * (`appBase` is kept for callers: nothing opens on the website any more.)
 */
export function notificationTarget(n, _appBase) {
  const type = String((n && n.entityType) || '').toLowerCase();
  const id = n && typeof n.entityId === 'string' && n.entityId ? n.entityId : null;
  if (type === 'task' && id) return { hash: `#/task/${encodeURIComponent(id)}` };
  if (type === 'conversation') return { hash: id ? `#/chat/${encodeURIComponent(id)}` : '#/chat' };
  if (type === 'meeting' && id) return { hash: `#/meeting/${encodeURIComponent(id)}` };
  return null;
}
