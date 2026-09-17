import { resolveBases } from '../src/config.js';
import { authedFetch } from '../src/auth.js';
import { decodeJwtSub } from '../src/jwt.js';
import { createReadCache } from '../src/read-cache.js';
import { createApi } from '../src/api.js';
import { enqueue, flushQueue, queueSize, makePerformMutation } from '../src/queue.js';
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

async function boot() {
  const root = document.getElementById('app');
  await applyStoredTheme(storage);
  const stored = await storage.get(['apiBase', 'appBase']);
  const { apiBase, appBase } = resolveBases(stored);
  const token = (await storage.get('accessToken')).accessToken;

  if (!token) {
    renderLogin(root, { apiBase, appBase });
    return;
  }

  const cache = createReadCache(storage);
  const api = createApi({ apiBase, storage, cache });
  const performMutation = makePerformMutation((path, init) => authedFetch(storage, apiBase, path, init));

  const state = { online: navigator.onLine, syncing: false, queueCount: 0, unread: 0 };
  const myId = decodeJwtSub(token);
  let me = { id: myId, name: 'You', email: '' };
  try {
    const dir = (await api.directory()).data ?? [];
    const u = dir.find((d) => d.id === myId);
    if (u) me = { id: myId, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username || 'You', email: u.email ?? u.username ?? '' };
  } catch {
    /* offline — keep the default; the directory may be cached later */
  }

  const app = new App({ root, api, cache, storage, apiBase, appBase, me, state, performMutation });
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
      params: params || {},
      query: query || {},
      isOnline: () => this.state.online,
      navigate: (hash) => { window.location.hash = hash; },
      openTask: (id) => { window.location.hash = `#/task/${id}`; },
      enqueue: (kind, payload) => enqueue(this.storage, { kind, payload }),
      afterMutation: () => this.refreshMeta(),
    };
  }

  start() {
    this.renderShell();
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('online', () => { this.state.online = true; this.renderStatus(); this.sync(); });
    window.addEventListener('offline', () => { this.state.online = false; this.renderStatus(); });
    this.route();
    this.refreshMeta();
    this.sync();
    setInterval(() => this.refreshMeta(), 60000);
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
    const { online, syncing, queueCount } = this.state;
    const cls = !online ? 'off' : syncing ? 'syncing' : '';
    const label = !online ? 'Offline' : syncing ? 'Syncing…' : 'Online';
    mount(this.connEl, el('span', { class: `dot ${cls}` }), `${label}${queueCount ? ` · ${queueCount} pending` : ''}`);
    this.offbar.classList.toggle('hidden', online);
  }

  setActiveNav(path) {
    for (const a of this.root.querySelectorAll('.navlink')) {
      const p = a.dataset.path;
      a.classList.toggle('active', p === '/' ? path === '/' : path.startsWith(p));
    }
  }

  async refreshMeta() {
    this.state.queueCount = await queueSize(this.storage);
    try {
      const c = (await this.api.notifications.unreadCount()).data;
      this.state.unread = typeof c?.count === 'number' ? c.count : 0;
    } catch { /* offline */ }
    const badge = this.root.querySelector('.nav-unread');
    if (badge) { badge.textContent = String(this.state.unread); badge.classList.toggle('hidden', !this.state.unread); }
    this.renderStatus();
  }

  async sync() {
    if (!this.state.online) return;
    this.state.syncing = true; this.renderStatus();
    try { await flushQueue(this.storage, this.performMutation); } catch { /* keep queue */ }
    this.state.syncing = false;
    await this.refreshMeta();
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

function renderLogin(root, cfg) {
  mount(root, LoginScreen({ ...cfg, storage, onAuthed: () => boot() }));
}

boot().catch((e) => {
  document.getElementById('app').append(el('div', { class: 'errbar' }, `Failed to start: ${e.message}`));
});
