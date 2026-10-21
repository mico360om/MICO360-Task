import { resolveBases } from '../src/config.js';
import { shouldNotify, notificationText, unreadBaseline, setToolbarBadge, NOTIFICATION_ID } from '../src/notify.js';
import { flushQueue, makePerformMutation, FLUSH_MESSAGE } from '../src/queue.js';
import { createAuth } from '../src/auth.js';
import { ensureSession } from '../src/session.js';
import { createReadCache } from '../src/read-cache.js';
import { rememberTask } from '../src/task-writes.js';
import { openAppTab } from '../src/open-app.js';
import { createMenu, onMenuClick } from '../src/context-menu.js';

const local = chrome.storage.local;
const sessionStore = chrome.storage.session;
/** The offline copies the app reads; a replayed task edit keeps its task's copy at the new version (H1). */
const cache = createReadCache(local);

function setBadge(count) {
  setToolbarBadge(chrome.action, count);
}

/**
 * The signed-in user's authenticated context, or null when signed out. ensureSession also ends a
 * session that belongs to a different server than the configured one (EXT-04).
 */
async function signedIn() {
  const { apiBase } = resolveBases(await local.get(['apiBase', 'appBase']));
  const s = await ensureSession({ local, session: sessionStore, apiBase });
  if (!s) return null;
  // One shared, locked refresh with the app tab (XP-04). When the server ends the session the
  // tokens are cleared; open app tabs notice the change and show the sign-in screen.
  const auth = createAuth({ local, session: sessionStore, apiBase, onExpired: () => setBadge(0) });
  return { ...s, apiBase, auth };
}

/** Replay the offline queue — the background worker is the one flusher (XP-06). */
async function flushNow(ctx) {
  const c = ctx || (await signedIn());
  if (!c) return null;
  const perform = makePerformMutation((path, init) => c.auth.authedFetch(path, init), { onTask: (t) => rememberTask(cache, t) });
  return flushQueue(local, perform, { userId: c.userId });
}

async function poll() {
  const ctx = await signedIn();
  if (!ctx) {
    setBadge(0);
    return;
  }
  try {
    const res = await ctx.auth.authedFetch('/notifications/unread-count');
    if (!res.ok) return;
    const json = await res.json();
    const count = json?.data?.count ?? 0;
    setBadge(count);

    // Desktop notification only when the count rises above this user's own baseline (EXT-06).
    const stored = await local.get(['lastUnread', 'lastUnreadUser']);
    if (shouldNotify(unreadBaseline(stored, ctx.userId), count)) {
      chrome.notifications?.create(NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'MICO360 Tasks',
        message: notificationText(count),
      });
    }
    await local.set({ lastUnread: count, lastUnreadUser: ctx.userId });

    // Connection is up — replay any offline changes and record the sync time.
    await flushNow(ctx);
    await local.set({ lastSync: Date.now() });
  } catch {
    /* offline — leave the badge as-is; the queue drains on the next successful poll */
  }
}

/** The full app in a tab: an open one is focused (src/open-app.js), else a new one opens. */
function openApp(hash = '') {
  return openAppTab(chrome, hash);
}

/** The polling alarm can be lost when the browser restarts; make sure it exists (EXT-06). */
async function ensurePollAlarm() {
  try {
    const existing = await chrome.alarms.get('poll');
    if (!existing) await chrome.alarms.create('poll', { periodInMinutes: 1 });
  } catch {
    /* alarms API unavailable */
  }
}

// The toolbar button opens the quick-capture popup (action.default_popup), as does the keyboard
// shortcut (commands._execute_action); its "Open MICO360 Tasks" button opens the full app.

chrome.notifications?.onClicked.addListener((id) => {
  if (id !== NOTIFICATION_ID) return;
  chrome.notifications.clear(id);
  void openApp('#/notifications');
});

// The right-click menu's "Add to MICO360 Tasks" (a selection, a link or the page) opens the popup
// with what was clicked. Chrome keeps the menu item; it is made again on install and update.
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  void onMenuClick(chrome, info, tab).catch(() => { /* the popup couldn't open: nothing to undo */ });
});

chrome.runtime.onInstalled.addListener(() => {
  void createMenu(chrome).catch(() => { /* no menus API */ });
  void ensurePollAlarm();
  void poll();
});
chrome.runtime.onStartup?.addListener(() => {
  void ensurePollAlarm();
  void poll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll') void poll();
});

// The app tab asks the worker to flush after reconnecting, so only one place replays the queue.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== FLUSH_MESSAGE || sender.id !== chrome.runtime.id) return false;
  flushNow().then(
    (r) => sendResponse(r || null),
    () => sendResponse(null),
  );
  return true; // respond asynchronously
});

// Every time the worker starts (install, browser start, or wake-up) check the alarm is there.
void ensurePollAlarm();
