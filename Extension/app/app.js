import { resolveBases, safeTimeZone, DEFAULT_TIME_ZONE } from '../src/config.js';
import { createAuth } from '../src/auth.js';
import { ensureSession, signOut as endSession } from '../src/session.js';
import { createReadCache } from '../src/read-cache.js';
import { createApi } from '../src/api.js';
import { flushQueue, queueStats, makePerformMutation, sendOrQueue, FLUSH_MESSAGE } from '../src/queue.js';
import { el, clear, mount } from './dom.js';
import { parseHash, matchRoute } from '../src/router.js';
import { applyStoredTheme } from './theme.js';

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

const storage = chrome.storage.local;
// The access token lives in memory-only session storage (EXT-07); local is the fallback on old Chrome.
const sessionStore = chrome.storage.session || null;
const NOTICE_KEY = 'mico360.loginNotice';

const NAV = [
  { path: '/', icon: '🏠', label: 'Dashboard' },
  { path: '/my-tasks', icon: '✓', label: 'My Tasks' },
  { path: '/projects', icon: '🗂', label: 'Projects' },
  { path: '/calendar', icon: '📅', label: 'Calendar' },
  { path: '/chat', icon: '💬', label: 'Chat' },
  { path: '/notifications', icon: '🔔', label: 'Notifications', badge: true },
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
    // XP-04: the server refused the session — go back to sign-in (queued changes are kept).
    onExpired: () => reloadWithNotice('Your session has ended. Sign in again — changes waiting to sync are kept.'),
  });
  const cache = createReadCache(storage);
  cache.prune().catch(() => { /* best effort */ });
  const api = createApi({ auth, cache });
  const performMutation = makePerformMutation((path, init) => auth.authedFetch(path, init));

  const state = { online: navigator.onLine, syncing: false, pending: 0, failed: 0, unread: 0 };
  const myId = session.userId;
  let me = { id: myId, name: 'You', email: '' };
  try {
    const dir = (await api.directory()).data ?? [];
    const u = dir.find((d) => d.id === myId);
    if (u) me = { id: myId, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username || 'You', email: u.email ?? u.username ?? '' };
  } catch {
    /* offline — keep the default; the directory may be cached later */
  }

  const app = new App({
    root, api, cache, auth, storage, apiBase, appBase, me, state, performMutation,
    timeZone: safeTimeZone(stored.companyTimeZone || DEFAULT_TIME_ZONE),
  });
  app.start();
}

class App {
  constructor(deps) {
    Object.assign(this, deps);
    this.contentBase = null; // last non-overlay hash, so the task drawer can layer over it
    this.overlay = null;
  }

  ctx(params, query) {
    return {
      api: this.api,
      cache: this.cache,
      storage: this.storage,
      apiBase: this.apiBase,
      appBase: this.appBase,
      me: this.me,
      timeZone: this.timeZone,
      params: params || {},
      query: query || {},
      isOnline: () => this.state.online,
      navigate: (hash) => { window.location.hash = hash; },
      openTask: (id) => { window.location.hash = `#/task/${id}`; },
      // Send a change now, or queue it (same Idempotency-Key) when the server can't be reached.
      write: (kind, payload) => sendOrQueue({ kind, payload }, {
        doFetch: (path, init) => this.auth.authedFetch(path, init),
        storage: this.storage,
        userId: this.me.id,
      }),
      afterMutation: () => this.refreshMeta(),
      requestSync: () => this.sync(),
      signOut: () => this.signOut(),
    };
  }

  start() {
    this.renderShell();
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('online', () => { this.state.online = true; this.renderStatus(); this.sync(); });
    window.addEventListener('offline', () => { this.state.online = false; this.renderStatus(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.syncQueue) this.refreshQueueCounts();
    });
    this.route();
    this.refreshMeta();
    this.sync();
    this.refreshTimeZone();
    setInterval(() => this.refreshMeta(), 60000);
  }

  /** Company time zone from GET /config (cached for the next start; used by boards and due dates). */
  async refreshTimeZone() {
    try {
      const cfg = await this.api.config();
      const tz = safeTimeZone(cfg && cfg.timeZone);
      if (tz !== this.timeZone) {
        this.timeZone = tz;
        await this.storage.set({ companyTimeZone: tz });
        this.route();
      } else {
        await this.storage.set({ companyTimeZone: tz });
      }
    } catch {
      /* offline — keep the cached/default zone */
    }
  }

  renderShell() {
    const nav = el('nav', { class: 'nav' },
      NAV.map((n) => el('a', { href: `#${n.path}`, class: 'navlink', dataset: { path: n.path } },
        el('span', { class: 'ic' }, n.icon), el('span', {}, n.label),
        n.badge ? el('span', { class: 'badge nav-unread hidden' }) : null,
      )),
    );
    const sidebar = el('aside', { class: 'sidebar' },
      el('div', { class: 'brand' }, el('span', { class: 'n' }, el('span', { class: 'm' }, 'MICO'), '360')),
      nav,
      el('div', { class: 'side-foot' },
        el('div', { class: 'side-user' },
          el('div', { class: 'avatar' }, (this.me.name[0] || 'U').toUpperCase()),
          el('div', { style: { minWidth: 0 } }, el('div', { class: 'nm' }, this.me.name), el('div', { class: 'em' }, this.me.email)),
        ),
      ),
    );
    this.titleEl = el('h1', {}, 'Dashboard');
    this.connEl = el('span', { class: 'conn' });
    this.offbar = el('div', { class: 'offbar hidden' }, 'Offline — showing saved data. Changes will sync when you reconnect.');
    this.content = el('div', { class: 'content' });
    const main = el('main', { class: 'main' },
      el('div', { class: 'topbar' }, this.titleEl, el('span', { class: 'sp' }), this.connEl),
      this.offbar,
      this.content,
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
      a.classList.toggle('active', p === '/' ? path === '/' : path.startsWith(p));
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
    try {
      const c = (await this.api.notifications.unreadCount()).data;
      this.state.unread = typeof c?.count === 'number' ? c.count : 0;
    } catch { /* offline */ }
    const badge = this.root.querySelector('.nav-unread');
    if (badge) { badge.textContent = String(this.state.unread); badge.classList.toggle('hidden', !this.state.unread); }
    this.renderStatus();
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
    await endSession({ local: this.storage, session: sessionStore });
    try { await chrome.action.setBadgeText({ text: '' }); } catch { /* ignore */ }
    reloadWithNotice('');
  }

  route() {
    const { path, query } = parseHash(window.location.hash);
    const matched = matchRoute(ROUTES, path) || { route: ROUTES[0], params: {} };
    const { route, params } = matched;

    if (route.overlay) {
      this.closeOverlay();
      this.overlay = route.screen(this.ctx(params, query), () => this.closeOverlay(true));
      document.body.append(this.overlay);
      return;
    }
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
  }

  closeOverlay(navigateBack) {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    if (navigateBack) {
      if (this.contentBase && this.contentBase !== window.location.hash) window.location.hash = this.contentBase;
      else window.location.hash = '#/';
    }
  }
}

boot().catch((e) => {
  document.getElementById('app').append(el('div', { class: 'errbar' }, `Failed to start: ${e.message}`));
});
