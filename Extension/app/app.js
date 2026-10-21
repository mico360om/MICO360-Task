import { resolveBases, safeTimeZone, DEFAULT_TIME_ZONE } from '../src/config.js';
import { createAuth, readSessionUser, publicUser } from '../src/auth.js';
import { ensureSession, signOut as endSession } from '../src/session.js';
import { createReadCache } from '../src/read-cache.js';
import { createApi } from '../src/api.js';
import { flushQueue, queueStats, makePerformMutation, sendOrQueue, pendingItems, FLUSH_MESSAGE } from '../src/queue.js';
import { rememberTask } from '../src/task-writes.js';
import { setToolbarBadge, clearDesktopAlert } from '../src/notify.js';
import { el, clear, mount, saveFile } from './dom.js';
import { decodeJwtRoles } from '../src/jwt.js';
import { parseHash, matchRoute, refreshOnReturn } from '../src/router.js';
import { applyStoredTheme } from './theme.js';
import { showModal, returnFocus, createRouteHold } from './dialog.js';
import { guardFileDrops } from '../src/file-drop-guard.js';

import { LoginScreen } from './screens/login.js';
import { DashboardScreen } from './screens/dashboard.js';
import { MyTasksScreen } from './screens/my-tasks.js';
import { ProjectsScreen } from './screens/projects.js';
import { BoardScreen } from './screens/board.js';
import { TaskDetail } from './screens/task-detail.js';
import { CalendarScreen } from './screens/calendar.js';
import { NotificationsScreen } from './screens/notifications.js';
import { ChatScreen } from './screens/chat.js';
import { SettingsScreen } from './screens/settings.js';
import { ReportsScreen } from './screens/reports.js';

const storage = chrome.storage.local;
// The access token lives in memory-only session storage (EXT-07), never on disk.
const sessionStore = chrome.storage.session;
const NOTICE_KEY = 'mico360.loginNotice';

const NAV = [
  { path: '/', icon: '🏠', label: 'Dashboard' },
  { path: '/my-tasks', icon: '✓', label: 'My Tasks' },
  { path: '/projects', icon: '🗂', label: 'Projects' },
  { path: '/calendar', icon: '📅', label: 'Calendar' },
  { path: '/chat', icon: '💬', label: 'Chat' },
  { path: '/notifications', icon: '🔔', label: 'Notifications', badge: true },
  { path: '/reports', icon: '📊', label: 'Reports', adminOnly: true },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
];

const ROUTES = [
  { name: 'dashboard', pattern: '/', title: 'Dashboard', screen: DashboardScreen },
  { name: 'my-tasks', pattern: '/my-tasks', title: 'My Tasks', screen: MyTasksScreen },
  { name: 'projects', pattern: '/projects', title: 'Projects', screen: ProjectsScreen },
  { name: 'board', pattern: '/board/:projectId', title: 'Board', screen: BoardScreen },
  { name: 'calendar', pattern: '/calendar', title: 'Calendar', screen: CalendarScreen },
  { name: 'chat', pattern: '/chat', title: 'Chat', screen: ChatScreen },
  { name: 'chat-thread', pattern: '/chat/:conversationId', title: 'Chat', screen: ChatScreen },
  { name: 'notifications', pattern: '/notifications', title: 'Notifications', screen: NotificationsScreen },
  { name: 'reports', pattern: '/reports', title: 'Reports', screen: ReportsScreen },
  { name: 'settings', pattern: '/settings', title: 'Settings', screen: SettingsScreen },
  { name: 'task', pattern: '/task/:taskId', title: 'Task', overlay: true, screen: TaskDetail },
];

/** 'login' or 'app' — what this tab is showing, so storage changes from elsewhere can resync it. */
let mode = null;
let currentUserId = null;
let reloading = false;

function reloadWithNotice(notice) {
  if (reloading) return;
  reloading = true;
  if (notice) {
    try { window.sessionStorage.setItem(NOTICE_KEY, notice); } catch { /* ignore */ }
  }
  window.location.hash = '#/';
  window.location.reload();
}

function takeNotice() {
  try {
    const n = window.sessionStorage.getItem(NOTICE_KEY);
    window.sessionStorage.removeItem(NOTICE_KEY);
    return n || '';
  } catch {
    return '';
  }
}

// Keep every open app tab in step with sign-in/sign-out done elsewhere (another tab, or the
// background worker finding the session has ended).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.refreshToken) {
    const signedIn = !!changes.refreshToken.newValue;
    if (mode === 'app' && !signedIn) reloadWithNotice('You have been signed out. Sign in to continue.');
    else if (mode === 'login' && signedIn) reloadWithNotice('');
  }
  if (changes.sessionUserId && mode === 'app' && changes.sessionUserId.newValue && changes.sessionUserId.newValue !== currentUserId) {
    reloadWithNotice('');
  }
});

async function boot() {
  const root = document.getElementById('app');
  await applyStoredTheme(storage);
  const stored = await storage.get(['apiBase', 'appBase', 'companyTimeZone']);
  const { apiBase, appBase } = resolveBases(stored);

  const session = await ensureSession({ local: storage, session: sessionStore, apiBase });
  if (!session) {
    mode = 'login';
    mount(root, LoginScreen({ apiBase, appBase, storage, session: sessionStore, notice: takeNotice(), onAuthed: () => reloadWithNotice('') }));
    return;
  }
  mode = 'app';
  currentUserId = session.userId;

  const auth = createAuth({
    local: storage,
    session: sessionStore,
    apiBase,
    // XP-04: the server refused the session — go back to sign-in (queued changes are kept). The last
    // desktop alert goes: it may say what it was about, and the next person may sign in here.
    onExpired: () => {
      clearDesktopAlert(chrome.notifications);
      reloadWithNotice('Your session has ended. Sign in again — changes waiting to sync are kept.');
    },
  });
  const cache = createReadCache(storage);
  cache.prune().catch(() => { /* best effort */ });
  const myId = session.userId;
  // Reads show this person's changes still waiting to sync on top (H3).
  const api = createApi({ auth, cache, pending: () => pendingItems(storage, myId) });
  // A replayed edit or move keeps the task's offline copy at the version it made (H1).
  const performMutation = makePerformMutation((path, init) => auth.authedFetch(path, init), { onTask: (t) => rememberTask(cache, t) });

  const state = { online: navigator.onLine, syncing: false, pending: 0, failed: 0, unread: 0 };
  // M12: who is signed in comes from the session (sign-in and refresh replies), so it is known even
  // offline; the name from the people directory.
  const me = { id: myId, name: 'You', email: '', roles: [] };
  let profile = null;
  try { profile = await readSessionUser(storage); } catch { profile = null; }
  if (profile && profile.id !== myId) profile = null;
  applyProfile(me, profile);
  if (!profile) {
    // A session from before profiles were kept: roles from the access token until the next refresh.
    try { me.roles = decodeJwtRoles((await auth.getTokens())?.accessToken); } catch { me.roles = []; }
  }
  try {
    const dir = (await api.directory()).data ?? [];
    const u = dir.find((d) => d.id === myId);
    if (u) me.name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username || me.name;
    if (u && !me.email) me.email = u.username || '';
  } catch {
    /* offline — keep what the session says; the directory may be cached later */
  }

  const app = new App({
    root, api, cache, auth, storage, apiBase, appBase, me, state, performMutation,
    manifest: chrome.runtime.getManifest(),
    timeZone: safeTimeZone(stored.companyTimeZone || DEFAULT_TIME_ZONE),
  });
  app.start();
}

/**
 * Take the signed-in person's email, username and roles from their session profile (M12). Roles
 * only decide which screens to offer (Reports); the server checks them on every call.
 */
function applyProfile(me, profile) {
  if (!profile) return;
  if (profile.email || profile.username) me.email = profile.email || profile.username;
  if (me.name === 'You' && profile.username) me.name = profile.username;
  me.roles = profile.roles || [];
}

class App {
  constructor(deps) {
    Object.assign(this, deps);
    this.contentBase = null; // last non-overlay hash, so the task drawer can layer over it
    this.overlay = null;
    // While a dialog is open over the screen (a board's New task form), the screen isn't drawn
    // again under it — not on coming back to the tab, nor on a hash change: those wait until it has
    // closed. The task drawer doesn't count (a route change is how it closes).
    this.hold = createRouteHold(document, { except: () => this.overlay });
  }

  ctx(params, query) {
    return {
      api: this.api,
      cache: this.cache,
      storage: this.storage,
      apiBase: this.apiBase,
      appBase: this.appBase,
      me: this.me,
      manifest: this.manifest,
      timeZone: this.timeZone,
      params: params || {},
      query: query || {},
      isOnline: () => this.state.online,
      navigate: (hash) => { window.location.hash = hash; },
      openTask: (id) => { window.location.hash = `#/task/${id}`; },
      // A page of the website (e.g. a meeting a notification is about) in a new tab.
      openExternal: (url) => { window.open(url, '_blank', 'noopener'); },
      reload: () => window.location.reload(),
      // Read the screen now shown again (once no dialog is open over it).
      refresh: () => this.refresh(),
      // Say something to screen readers from the app's own live region (it outlives a screen).
      announce: (text) => this.announce(text),
      saveFile,
      write: (kind, payload, opts) => this.write(kind, payload, opts),
      afterMutation: () => this.refreshMeta(),
      requestSync: () => this.sync(),
      signOut: () => this.signOut(),
    };
  }

  /**
   * Send a change now, or queue it (same Idempotency-Key) when the server can't be reached. A task's
   * reply keeps its offline copy at the new version (H1). A change queued behind others while online
   * (one edit of a task at a time) is synced straight away, unless a waiting change keeps failing. One
   * whose own send failed waits for the next alarm or reconnect: trying it again at once would only
   * spend one of its tries. The new-task form (a board's "Add a task") gives its task's own key
   * (`idempotencyKey`, so trying again can't make a second task) and `hold` (a task with files is
   * never queued: the form offers to save it without them).
   */
  async write(kind, payload, { idempotencyKey, hold = false } = {}) {
    const r = await sendOrQueue({ kind, payload }, {
      doFetch: (path, init) => this.auth.authedFetch(path, init),
      storage: this.storage,
      userId: this.me.id,
      onTask: (t) => rememberTask(this.cache, t),
      ...(idempotencyKey ? { newKey: () => idempotencyKey } : {}),
      hold,
    });
    if (r.syncNow && this.state.online) void this.sync();
    return r;
  }

  start() {
    this.renderShell();
    window.addEventListener('hashchange', () => this.hold.run(() => this.route()));
    window.addEventListener('online', () => { this.state.online = true; this.renderStatus(); this.sync(); });
    window.addEventListener('offline', () => { this.state.online = false; this.renderStatus(); });
    // No live connection: coming back to the tab reloads task screens, so changes made elsewhere
    // (such as the next copy of a recurring task) appear.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const matched = matchRoute(ROUTES, parseHash(window.location.hash).path);
      if (refreshOnReturn(matched && matched.route, Boolean(this.overlay))) this.refresh();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.syncQueue) this.refreshQueueCounts();
      // M12: a refresh (here or in the background) brings the person's current roles.
      if (changes.sessionUser) this.updateProfile(publicUser(changes.sessionUser.newValue));
    });
    this.route();
    this.refreshMeta();
    this.sync();
    this.refreshTimeZone();
    setInterval(() => this.refreshMeta(), 60000);
    // No "newer version" banner: most releases change only the website, so a newer server doesn't
    // mean a newer extension file. Settings → About shows both versions and how to update.
  }

  /** Company time zone from GET /config (cached for the next start; used by boards and due dates). */
  async refreshTimeZone() {
    try {
      const cfg = await this.api.config();
      const tz = safeTimeZone(cfg && cfg.timeZone);
      if (tz !== this.timeZone) {
        this.timeZone = tz;
        await this.storage.set({ companyTimeZone: tz });
        // Built again in the company's zone — not under a dialog, nor under the task drawer (the
        // screen is built again when the drawer closes).
        this.hold.run(() => { if (!this.overlay) this.route(); });
      } else {
        await this.storage.set({ companyTimeZone: tz });
      }
    } catch {
      /* offline — keep the cached/default zone */
    }
  }

  /** The signed-in person's profile changed (a refresh): show their current roles' screens (M12). */
  updateProfile(profile) {
    if (!profile || profile.id !== this.me.id) return;
    const before = (this.me.roles || []).join(',');
    applyProfile(this.me, profile);
    this.renderUser();
    if ((this.me.roles || []).join(',') !== before) {
      this.renderNav();
      this.setActiveNav(parseHash(window.location.hash).path);
      this.renderBadge();
    }
  }

  renderNav() {
    mount(this.navEl,
      NAV.filter((n) => !n.adminOnly || (this.me.roles || []).includes('ADMIN')).map((n) => el('a', { href: `#${n.path}`, class: 'navlink', dataset: { path: n.path } },
        el('span', { class: 'ic', 'aria-hidden': 'true' }, n.icon), el('span', {}, n.label),
        n.badge ? el('span', { class: 'badge nav-unread hidden' }) : null,
      )),
    );
  }

  renderUser() {
    mount(this.userEl,
      el('div', { class: 'avatar' }, (this.me.name[0] || 'U').toUpperCase()),
      el('div', { style: { minWidth: 0 } }, el('div', { class: 'nm' }, this.me.name), el('div', { class: 'em' }, this.me.email)),
    );
  }

  renderShell() {
    this.navEl = el('nav', { class: 'nav' });
    this.userEl = el('div', { class: 'side-user' });
    this.renderNav();
    this.renderUser();
    const sidebar = el('aside', { class: 'sidebar' },
      el('div', { class: 'brand' }, el('span', { class: 'n' }, el('span', { class: 'm' }, 'MICO'), '360')),
      this.navEl,
      el('div', { class: 'side-foot' }, this.userEl,
        el('a', { class: 'side-ver', href: '#/settings', title: 'Versions and updates: Settings → About' }, `Version ${this.manifest?.version || ''}`)),
    );
    this.titleEl = el('h1', {}, 'Dashboard');
    this.connEl = el('span', { class: 'conn' });
    this.offbar = el('div', { class: 'offbar hidden' }, 'Offline — showing saved data. Changes will sync when you reconnect.');
    this.content = el('div', { class: 'content' });
    this.live = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const main = el('main', { class: 'main' },
      el('div', { class: 'topbar' }, this.titleEl, el('span', { class: 'sp' }), this.connEl),
      this.offbar,
      this.content,
      this.live,
    );
    mount(this.root, el('div', { class: 'app' }, sidebar, main));
    this.renderStatus();
  }

  renderStatus() {
    const { online, syncing, pending, failed } = this.state;
    const cls = !online ? 'off' : syncing ? 'syncing' : '';
    const label = !online ? 'Offline' : syncing ? 'Syncing…' : 'Online';
    const extra = [pending ? `${pending} pending` : null, failed ? `${failed} failed` : null].filter(Boolean).join(' · ');
    mount(this.connEl, el('span', { class: `dot ${cls}` }), `${label}${extra ? ` · ${extra}` : ''}`);
    if (failed) {
      this.connEl.setAttribute('title', 'Some changes could not be synced — see Settings → Sync.');
    } else {
      this.connEl.removeAttribute('title');
    }
    this.offbar.classList.toggle('hidden', online);
  }

  setActiveNav(path) {
    for (const a of this.root.querySelectorAll('.navlink')) {
      const p = a.dataset.path;
      const active = p === '/' ? path === '/' : path.startsWith(p);
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  async refreshQueueCounts() {
    try {
      const s = await queueStats(this.storage, this.me.id);
      this.state.pending = s.pending;
      this.state.failed = s.failed;
    } catch { /* storage unavailable */ }
    this.renderStatus();
  }

  async refreshMeta() {
    await this.refreshQueueCounts();
    const before = this.state.unread;
    let counted = false;
    try {
      // Notifications marked read but still waiting to sync are already left out (H3).
      const c = (await this.api.notifications.unreadCount()).data;
      this.state.unread = typeof c?.count === 'number' ? c.count : 0;
      counted = true;
    } catch { /* offline */ }
    this.renderBadge();
    this.renderStatus();
    // Something new (or read elsewhere): the Notifications screen reads itself again in place (Stage 5).
    if (counted && this.state.unread !== before && this.routeName() === 'notifications') this.refresh();
  }

  /** The name of the route shown under any drawer (e.g. 'notifications'). */
  routeName() {
    const matched = matchRoute(ROUTES, parseHash(this.contentBase || window.location.hash).path);
    return matched ? matched.route.name : null;
  }

  /** The unread count in the sidebar and, at the same moment, on the toolbar icon (M7). */
  renderBadge() {
    const badge = this.root.querySelector('.nav-unread');
    if (badge) { badge.textContent = String(this.state.unread); badge.classList.toggle('hidden', !this.state.unread); }
    setToolbarBadge(chrome.action, this.state.unread);
  }

  /**
   * Ask the background service worker — the one flusher — to replay the queue now. If it can't be
   * reached, flush here under the same cross-context lock, so two flushes never overlap (XP-06).
   */
  async sync() {
    if (!this.state.online) return;
    this.state.syncing = true; this.renderStatus();
    try {
      let result = null;
      try {
        result = await chrome.runtime.sendMessage({ type: FLUSH_MESSAGE });
      } catch {
        result = null;
      }
      if (!result) result = await flushQueue(this.storage, this.performMutation, { userId: this.me.id });
      if (result && !result.paused && !result.skipped) await this.storage.set({ lastSync: Date.now() });
    } catch { /* keep the queue for the next attempt */ }
    this.state.syncing = false;
    await this.refreshMeta();
  }

  async signOut() {
    mode = null; // our own sign-out: don't treat the token removal as a remote sign-out
    await endSession({ local: this.storage, session: sessionStore, notifications: chrome.notifications });
    try { await chrome.action.setBadgeText({ text: '' }); } catch { /* ignore */ }
    reloadWithNotice('');
  }

  /** Say `text` to screen readers (the app's polite live region, which outlives any screen). */
  announce(text) {
    this.live.textContent = text || '';
  }

  /**
   * Read the screen now shown again: in place when it can (a board keeps its dialogs, focus and
   * announcements), else built again. Held while a dialog is open over it; skipped under the task
   * drawer (closing the drawer builds the screen again anyway).
   */
  refresh() {
    this.hold.run(() => {
      if (this.overlay) return;
      const screen = this.content.firstElementChild;
      const inPlace = screen && typeof screen.refresh === 'function' ? screen.refresh() : null;
      if (!inPlace) this.route();
    });
  }

  route() {
    const { path, query } = parseHash(window.location.hash);
    const matched = matchRoute(ROUTES, path) || { route: ROUTES[0], params: {} };
    const { route, params } = matched;

    if (route.overlay) {
      // What opened the drawer (a board card, a task row), so focus can go back to it on close.
      if (!this.overlay) {
        const a = document.activeElement;
        this.opener = { el: a && this.content.contains(a) ? a : null, taskId: params.taskId };
      }
      this.closeOverlay();
      this.overlay = route.screen(this.ctx(params, query), () => this.closeOverlay(true));
      document.body.append(this.overlay);
      // A modal dialog: focus moves in and stays in, the page behind is inert, Escape closes it.
      this.releaseModal = showModal(this.overlay, { onEscape: () => this.closeOverlay(true) });
      return;
    }
    const opener = this.opener; // set while a drawer is (or just was) open
    this.opener = null;
    this.closeOverlay();
    this.contentBase = window.location.hash || '#/';
    this.titleEl.textContent = route.title;
    this.setActiveNav(path);
    clear(this.content);
    try {
      const node = route.screen(this.ctx(params, query));
      this.content.append(node);
    } catch (e) {
      this.content.append(el('div', { class: 'errbar' }, `Screen error: ${e.message}`));
    }
    // Back from the drawer: focus the card or row that opened it once the screen has drawn it again.
    if (opener) returnFocus(this.content, opener);
  }

  closeOverlay(navigateBack) {
    if (this.releaseModal) { this.releaseModal(); this.releaseModal = null; }
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (navigateBack) {
      if (this.contentBase && this.contentBase !== window.location.hash) window.location.hash = this.contentBase;
      else window.location.hash = '#/';
    }
  }
}

// A file dropped where nothing takes it never opens in this tab (unsent drafts would be lost).
guardFileDrops(document);
boot().catch((e) => {
  document.getElementById('app').append(el('div', { class: 'errbar' }, `Failed to start: ${e.message}`));
});
