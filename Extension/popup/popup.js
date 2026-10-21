/**
 * The toolbar popup (action.default_popup): quick capture of a new task from any page. It opens from
 * the toolbar icon, the keyboard shortcut (commands._execute_action) or the right-click menu's "Add
 * to MICO360 Tasks" (which hands over what was clicked through session storage). Before Chrome 127
 * the right-click menu opens this page in a small window instead (`?window=1`).
 *
 * The popup shares the app's session, offline cache and queue: a task saved offline is synced by
 * the background worker like any other change.
 */
import { resolveBases, safeTimeZone, DEFAULT_TIME_ZONE } from '../src/config.js';
import { createAuth, readSessionUser } from '../src/auth.js';
import { ensureSession } from '../src/session.js';
import { createReadCache } from '../src/read-cache.js';
import { createApi } from '../src/api.js';
import { sendOrQueue, pendingItems, newIdempotencyKey } from '../src/queue.js';
import { openAppTab, APP_PATH } from '../src/open-app.js';
import { CAPTURE_KEY } from '../src/quick-add.js';
import { applyStoredTheme } from '../app/theme.js';
import { el, mount } from '../app/dom.js';
import { QuickAddForm, SignedOutView } from './quick-add-form.js';
import { guardFileDrops } from '../src/file-drop-guard.js';
import { canOpenSidePanel, openSidePanel } from '../src/side-panel.js';

const local = chrome.storage.local;
// The access token lives in memory-only session storage (EXT-07), never on disk.
const sessionStore = chrome.storage.session;
const inWindow = new URLSearchParams(window.location.search).get('window') === '1';
/** A capture the popup never picked up (it didn't open) is not used later. */
const CAPTURE_FRESH_MS = 10 * 60 * 1000;

/** What the right-click menu captured for this popup, taken once. */
async function takeCapture() {
  try {
    const c = ((await sessionStore.get(CAPTURE_KEY)) || {})[CAPTURE_KEY];
    await sessionStore.remove(CAPTURE_KEY);
    return c && typeof c.at === 'number' && Date.now() - c.at < CAPTURE_FRESH_MS ? c : null;
  } catch {
    return null;
  }
}

/**
 * The page the person is on. Opening the popup grants this extension the tab for the moment
 * (`activeTab`, no install warning), so its title and address can be read without the "tabs"
 * permission. In a window of its own, the page is the one the right-click menu was used on.
 */
async function activePage(capture) {
  if (inWindow) return capture && capture.page ? capture.page : null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && tab.url ? { title: tab.title || '', url: tab.url } : null;
  } catch {
    return null;
  }
}

/**
 * Call `fn` when the right-click menu keeps a new capture. Only in a window of its own (before
 * Chrome 127): the menu focuses that window instead of opening another, and it stays open.
 */
function onNewCapture(fn) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[CAPTURE_KEY] && changes[CAPTURE_KEY].newValue) fn();
  });
}

async function shortcut() {
  const all = await chrome.commands.getAll();
  const open = all.find((c) => c.name === '_execute_action');
  return (open && open.shortcut) || '';
}

async function boot() {
  const root = document.getElementById('popup');
  if (inWindow) document.body.classList.add('in-window');
  await applyStoredTheme(local);
  const stored = await local.get(['apiBase', 'appBase', 'companyTimeZone']);
  const { apiBase, appBase } = resolveBases(stored);
  const frame = { openApp: (hash) => openAppTab(chrome, hash), close: () => window.close() };

  const signed = await ensureSession({ local, session: sessionStore, apiBase });
  if (!signed) {
    // A right-click capture stays for a few minutes: signing in and opening the popup again uses it.
    mount(root, SignedOutView(frame));
    if (inWindow) onNewCapture(() => window.location.reload()); // signed in since? then the form takes it
    return;
  }
  const capture = await takeCapture();
  let latest = capture;
  const userId = signed.userId;
  // The window this popup is on, so its side panel can open straight from the click (Stage 7). Not
  // in the small window before Chrome 127: that kind of window has no side panel.
  let windowId = null;
  if (!inWindow && canOpenSidePanel(chrome)) {
    try {
      windowId = (await chrome.windows.getCurrent()).id;
    } catch {
      windowId = null;
    }
  }
  const auth = createAuth({
    local,
    session: sessionStore,
    apiBase,
    onExpired: () => mount(root, SignedOutView(frame, 'Your session has ended. Sign in again — tasks waiting to sync are kept.')),
  });
  const api = createApi({ auth, cache: createReadCache(local), pending: () => pendingItems(local, userId) });
  let profile = null;
  try {
    profile = await readSessionUser(local);
  } catch {
    profile = null;
  }
  const ctx = {
    ...frame,
    api,
    me: { id: userId, name: (profile && profile.id === userId && profile.username) || 'You' },
    local,
    session: sessionStore,
    appBase,
    appPage: chrome.runtime.getURL(APP_PATH),
    timeZone: safeTimeZone(stored.companyTimeZone || DEFAULT_TIME_ZONE),
    isOnline: () => navigator.onLine,
    newKey: newIdempotencyKey,
    // The app's online-first write: sent now, or kept in the queue (same Idempotency-Key) when the
    // server can't be reached. `hold`: a task with files is never queued — the popup asks first.
    send: (kind, payload, { idempotencyKey, hold = false } = {}) => sendOrQueue({ kind, payload }, {
      doFetch: (path, init) => auth.authedFetch(path, init),
      storage: local,
      userId,
      newKey: () => idempotencyKey || newIdempotencyKey(),
      hold,
    }),
    currentPage: () => activePage(latest),
    capture,
    // A window of its own takes dropped files, closes once a task is created, and takes new captures
    // (its "page you are on" is then the one picked last).
    inWindow,
    onCapture: inWindow ? (use) => onNewCapture(() => takeCapture().then((c) => {
      if (!c) return;
      latest = c;
      use(c);
    })) : undefined,
    shortcut,
    // "Open the side panel": asked at once (in the click), then the popup closes once it is open.
    openPanel: typeof windowId === 'number'
      ? () => { void openSidePanel(chrome, windowId).then((opened) => { if (opened) window.close(); }); }
      : undefined,
  };
  mount(root, QuickAddForm(ctx));
  // The company's time zone decides "today" for "Describe it"; keep it for next time (as the app does).
  api.config().then((cfg) => {
    ctx.timeZone = safeTimeZone(cfg && cfg.timeZone);
    return local.set({ companyTimeZone: ctx.timeZone });
  }).catch(() => { /* offline — keep the saved zone */ });
}

// A file dropped where nothing takes it never opens in the popup (what was typed would be lost).
guardFileDrops(document);
boot().catch((e) => {
  document.getElementById('popup').append(el('div', { class: 'errbar', role: 'alert' }, `Couldn’t start: ${e.message}`));
});
