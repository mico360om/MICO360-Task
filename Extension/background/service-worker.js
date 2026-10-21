import { resolveBases } from '../src/config.js';
import { setToolbarBadge, clearDesktopAlert, NOTIFICATION_ID } from '../src/notify.js';
import { flushQueue, makePerformMutation, sendOrQueue, FLUSH_MESSAGE } from '../src/queue.js';
import { createAuth } from '../src/auth.js';
import { ensureSession } from '../src/session.js';
import { createReadCache } from '../src/read-cache.js';
import { rememberTask } from '../src/task-writes.js';
import { openAppTab } from '../src/open-app.js';
import { createMenu, onMenuClick } from '../src/context-menu.js';
import { pollNotifications, openAlert } from '../src/background-poll.js';
import { readSessionUser } from '../src/auth.js';
import { searchable } from '../src/search.js';
import { omniboxSuggestions, omniboxTarget, defaultSuggestion } from '../src/omnibox.js';

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
  // tokens are cleared; open app tabs notice the change and show the sign-in screen. The badge and
  // the last desktop alert go with it.
  const auth = createAuth({ local, session: sessionStore, apiBase, onExpired: () => sessionEnded() });
  return { ...s, apiBase, auth };
}

/** Replay the offline queue — the background worker is the one flusher (XP-06). */
async function flushNow(ctx) {
  const c = ctx || (await signedIn());
  if (!c) return null;
  const perform = makePerformMutation((path, init) => c.auth.authedFetch(path, init), { onTask: (t) => rememberTask(cache, t) });
  return flushQueue(local, perform, { userId: c.userId });
}

/** Nobody is signed in (any more): no count on the icon, and no alert of theirs left on screen. */
function sessionEnded() {
  setBadge(0);
  clearDesktopAlert(chrome.notifications);
}

async function poll() {
  const ctx = await signedIn();
  if (!ctx) {
    sessionEnded();
    return;
  }
  try {
    // The badge, and a desktop alert only when the count rises above this user's own baseline
    // (EXT-06) — saying what the newest is about only when this device allows it (Stage 5).
    const r = await pollNotifications({
      authedFetch: (path, init) => ctx.auth.authedFetch(path, init),
      local,
      session: sessionStore,
      notifications: chrome.notifications,
      setBadge,
      userId: ctx.userId,
    });
    if (!r) return; // offline — leave the badge as-is; the queue drains on the next successful poll

    // Connection is up — replay any offline changes and record the sync time.
    await flushNow(ctx);
    await local.set({ lastSync: Date.now() });
  } catch {
    /* offline — the queue drains on the next successful poll */
  }
}

/**
 * The desktop alert was clicked: open what it was about (marked read: sent now, or kept for later
 * like any change), else Notifications. The badge then follows.
 */
async function alertClicked() {
  const ctx = await signedIn();
  const { appBase } = resolveBases(await local.get(['apiBase', 'appBase']));
  await openAlert({
    session: sessionStore,
    open: (hash) => openApp(hash),
    openUrl: (url) => chrome.tabs.create({ url }),
    markRead: (id) => (ctx
      ? sendOrQueue({ kind: 'notification.read', payload: { id } }, { doFetch: (path, init) => ctx.auth.authedFetch(path, init), storage: local, userId: ctx.userId })
      : null),
    appBase,
    userId: ctx ? ctx.userId : null,
  });
  if (ctx) await poll();
}

/** The full app in a tab: an open one is focused (src/open-app.js), else a new one opens. */
function openApp(hash = '') {
  return openAppTab(chrome, hash);
}

// ---- "mico" in the address bar (Stage 6) ----------------------------------------------------

let omniAsked = 0; // the newest words typed: an older answer arriving late is dropped

/** Whether the signed-in person is an admin (admin pages are suggested only to them). */
async function isAdmin() {
  try {
    const u = await readSessionUser(local);
    return !!(u && Array.isArray(u.roles) && u.roles.includes('ADMIN'));
  } catch {
    return false;
  }
}

/** Suggestions for the words typed after "mico": pages, and what GET /search finds. */
async function omniboxSuggest(text, suggest) {
  const mine = (omniAsked += 1);
  let ctx = null;
  try { ctx = await signedIn(); } catch { ctx = null; }
  try { chrome.omnibox.setDefaultSuggestion({ description: defaultSuggestion(!!ctx) }); } catch { /* older Chrome */ }
  if (!ctx) {
    suggest([]);
    return;
  }
  let results = null;
  if (searchable(text)) {
    try {
      const res = await ctx.auth.authedFetch(`/search?q=${encodeURIComponent(text.trim())}`);
      const json = res && res.ok ? await res.json() : null;
      results = json && typeof json === 'object' ? json.data : null;
    } catch {
      results = null; // offline: the pages still show
    }
  }
  if (mine !== omniAsked) return;
  suggest(omniboxSuggestions(results, text, { isAdmin: await isAdmin() }));
}

/** Enter: a chosen suggestion opens here (or a page on the website); words open the Search screen. */
async function omniboxOpen(text) {
  const { appBase } = resolveBases(await local.get(['apiBase', 'appBase']));
  const target = omniboxTarget(text, { appBase, isAdmin: await isAdmin() });
  if (target.url) await chrome.tabs.create({ url: target.url });
  else await openApp(target.hash);
}

chrome.omnibox?.onInputChanged.addListener((text, suggest) => {
  void omniboxSuggest(text, suggest).catch(() => suggest([]));
});
chrome.omnibox?.onInputEntered.addListener((text) => {
  void omniboxOpen(text).catch(() => openApp('#/'));
});

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
  void alertClicked().catch(() => openApp('#/notifications'));
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
