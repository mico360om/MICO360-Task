import { resolveBases } from '../src/config.js';
import { shouldNotify, notificationText, unreadBaseline, findAppContext, NOTIFICATION_ID } from '../src/notify.js';
import { flushQueue, makePerformMutation, FLUSH_MESSAGE } from '../src/queue.js';
import { createAuth } from '../src/auth.js';
import { ensureSession } from '../src/session.js';
import { badgeText } from '../src/chat.js';

const local = chrome.storage.local;
const sessionStore = chrome.storage.session || null;
const APP_PATH = 'app/app.html';

function setBadge(count) {
  chrome.action.setBadgeText({ text: badgeText(count) });
  if (count > 0) chrome.action.setBadgeBackgroundColor({ color: '#8B1E1E' });
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
  return flushQueue(local, makePerformMutation((path, init) => c.auth.authedFetch(path, init)), { userId: c.userId });
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

/**
 * The extension UI is a full-page tab (no popup). Focus an open one (found via
 * runtime.getContexts, so no "tabs" permission is needed — EXT-07) or open a new tab.
 */
async function openApp(hash = '') {
  const base = chrome.runtime.getURL(APP_PATH);
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const found = findAppContext(contexts, base);
    if (found) {
      await chrome.tabs.update(found.tabId, { active: true, ...(hash ? { url: base + hash } : {}) });
      if (typeof found.windowId === 'number' && found.windowId >= 0) await chrome.windows?.update(found.windowId, { focused: true });
      return;
    }
  } catch {
    /* getContexts unavailable (Chrome < 116) — just open a new tab */
  }
  await chrome.tabs.create({ url: base + hash });
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

chrome.action.onClicked.addListener(() => void openApp());

chrome.notifications?.onClicked.addListener((id) => {
  if (id !== NOTIFICATION_ID) return;
  chrome.notifications.clear(id);
  void openApp('#/notifications');
});

chrome.runtime.onInstalled.addListener(() => {
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
