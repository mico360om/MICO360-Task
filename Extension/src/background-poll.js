/**
 * What the background worker does on each poll (chrome.alarms, every minute) and when its desktop
 * alert is clicked — kept here, apart from the worker's wiring, so it can be tested.
 *
 * A poll reads the unread count and puts it on the toolbar icon. When it has risen above this
 * person's own last count, a desktop alert says how many are new — or, when this device allows it
 * (Settings → Notifications), what the newest one is about, and a click then opens that item. The
 * server only makes the notifications someone hasn't switched off, so the alert follows their
 * preferences. Every poll also reports the direct messages that reached this device (the sender
 * then sees "Delivered"), as the web does for every message — whether or not they made a
 * notification.
 */
import {
  shouldNotify, unreadBaseline, readAlertSettings, newestUnread, alertContent, notificationTarget, NOTIFICATION_ID, ALERT_TARGET_KEY,
} from './notify.js';
import { needsDeliveryAck } from './chat.js';

async function json(res) {
  if (!res || !res.ok) return null;
  try {
    const j = await res.json();
    return j && typeof j === 'object' && 'data' in j ? j.data : null;
  } catch {
    return null;
  }
}

/** Best effort: a report that couldn't be made is made on a later poll (the summary still asks for it). */
async function reportDeliveries(authedFetch, userId) {
  try {
    const inbox = await json(await authedFetch('/conversations'));
    if (!Array.isArray(inbox)) return;
    for (const s of inbox) {
      if (!s || !s.conversation || !Array.isArray(s.participants) || !needsDeliveryAck(s, userId)) continue;
      try {
        await authedFetch(`/conversations/${encodeURIComponent(s.conversation.id)}/delivered`, { method: 'POST' });
      } catch {
        /* offline now: a later poll reports it */
      }
    }
  } catch {
    /* offline */
  }
}

/**
 * One poll. `authedFetch(path, init)` is the signed-in person's fetch; `notifications` is
 * chrome.notifications. Resolves `{ count }`, or null when the server couldn't be read (the badge
 * and the baseline stay as they were).
 */
export async function pollNotifications({ authedFetch, local, session, notifications, setBadge, userId }) {
  let count;
  try {
    const data = await json(await authedFetch('/notifications/unread-count'));
    if (!data || typeof data.count !== 'number') return null;
    count = data.count;
  } catch {
    return null;
  }
  setBadge(count);
  const stored = await local.get(['lastUnread', 'lastUnreadUser']);
  const baseline = unreadBaseline(stored, userId);
  if (shouldNotify(baseline, count)) {
    const settings = await readAlertSettings(local);
    if (settings.on) {
      let newest = null;
      if (settings.details) {
        try {
          newest = newestUnread(await json(await authedFetch('/notifications')));
        } catch {
          newest = null;
        }
      }
      const content = alertContent({ fresh: count - baseline, newest, details: settings.details });
      try {
        await session.set({ [ALERT_TARGET_KEY]: newest ? { id: newest.id, entityType: newest.entityType ?? null, entityId: newest.entityId ?? null, userId } : null });
      } catch { /* the click then opens Notifications */ }
      try {
        notifications?.create(NOTIFICATION_ID, { type: 'basic', iconUrl: 'icons/icon128.png', ...content });
      } catch { /* no desktop notifications here */ }
    }
  }
  // The count first: a worker stopped while reporting must not alert about the same ones again.
  await local.set({ lastUnread: count, lastUnreadUser: userId });
  // Every poll, as the web reports every message: a second message in a conversation, or one in a
  // muted conversation, makes no new notification, but its sender should still see "Delivered".
  await reportDeliveries(authedFetch, userId);
  return { count };
}

/**
 * The desktop alert was clicked. One that said what it was about opens that item (a task in the
 * drawer, a conversation in Chat, a meeting on its page) and marks it read; any other opens
 * Notifications. `open(hash)` opens the app, `openUrl(url)` the website, `markRead(id)` sends the
 * read now or keeps it for later.
 */
export async function openAlert({ session, open, openUrl, markRead, appBase, userId }) {
  let target = null;
  try {
    target = ((await session.get(ALERT_TARGET_KEY)) || {})[ALERT_TARGET_KEY] || null;
    await session.remove(ALERT_TARGET_KEY);
  } catch {
    target = null;
  }
  if (!target || !target.id || target.userId !== userId) {
    await open('#/notifications');
    return;
  }
  const where = notificationTarget(target, appBase);
  try {
    await markRead(target.id);
  } catch {
    /* it stays unread: the Notifications screen shows it */
  }
  if (where && where.hash) await open(where.hash);
  else if (where && where.url) await openUrl(where.url);
  else await open('#/notifications');
}
