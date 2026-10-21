import { resolveBases, safeTimeZone, DEFAULT_TIME_ZONE } from '../src/config.js';
import { createAuth, readSessionUser, publicUser } from '../src/auth.js';
import { ensureSession, signOut as endSession } from '../src/session.js';
import { createReadCache } from '../src/read-cache.js';
import { createApi } from '../src/api.js';
import { flushQueue, queueStats, makePerformMutation, sendOrQueue, pendingItems, newIdempotencyKey, FLUSH_MESSAGE } from '../src/queue.js';
import { rememberTask } from '../src/task-writes.js';
import { setToolbarBadge, clearDesktopAlert } from '../src/notify.js';
import { el, clear, mount, saveFile } from './dom.js';
import { decodeJwtRoles } from '../src/jwt.js';
import { parseHash, matchRoute, refreshOnReturn } from '../src/router.js';
import { applyStoredTheme } from './theme.js';
import { showModal, returnFocus, createRouteHold, modalOpen } from './dialog.js';
import { svgIcon } from './components.js';
import { openSearch, searchShortcut } from './search.js';
import { guardFileDrops } from '../src/file-drop-guard.js';
import { createChatDrafts } from '../src/chat-drafts.js';
import { openAppTab } from '../src/open-app.js';
import { canOpenSidePanel, openSidePanel, panelShows, PANEL_LIVE_ROUTES, PANEL_FAILED_MESSAGE } from '../src/side-panel.js';
import { PanelShell } from './panel-shell.js';
import { QuickAddForm, SignedOutView } from '../popup/quick-add-form.js';
import { panelDraftKey } from '../src/quick-add.js';

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
import { SearchScreen } from './screens/search.js';
import { MeetingsScreen } from './screens/meetings.js';
import { MeetingScreen } from './screens/meeting.js';
import { TodayScreen } from './screens/today.js';

/**
 * Chrome's side panel (Stage 7) is this app in short: app/panel.html says so (`data-layout`). It
 * shows Today, My Tasks and Add a task, with a task's panel over them; any other page opens in the
 * full app page. The same session, offline copies, queue and rules as the app tab.
 */
const PANEL = typeof document !== 'undefined' && document.documentElement.dataset.layout === 'panel';
const SIDE_PANEL_ICON = ['M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M15 4v16'];

const storage = chrome.storage.local;
// The access token lives in memory-only session storage (EXT-07), never on disk.
const sessionStore = chrome.storage.session;
const NOTICE_KEY = 'mico360.loginNotice';
const MAC = /Mac/i.test((typeof navigator !== 'undefined' && navigator.platform) || '');
const SEARCH_ICON = ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm21 21-4.3-4.3'];

const NAV = [
  { path: '/', icon: '🏠', label: 'Dashboard' },
  { path: '/my-tasks', icon: '✓', label: 'My Tasks' },
  { path: '/projects', icon: '🗂', label: 'Projects' },
  { path: '/calendar', icon: '📅', label: 'Calendar' },
  { path: '/meetings', icon: '👥', label: 'Meetings' },
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
  { name: 'meetings', pattern: '/meetings', title: 'Meetings', screen: MeetingsScreen },
  { name: 'meeting', pattern: '/meeting/:meetingId', title: 'Meeting', screen: MeetingScreen },
  { name: 'search', pattern: '/search', title: 'Search', screen: SearchScreen },
  { name: 'chat', pattern: '/chat', title: 'Chat', screen: ChatScreen },
  { name: 'chat-thread', pattern: '/chat/:conversationId', title: 'Chat', screen: ChatScreen },
  { name: 'notifications', pattern: '/notifications', title: 'Notifications', screen: NotificationsScreen },
  { name: 'reports', pattern: '/reports', title: 'Reports', screen: ReportsScreen },
  { name: 'settings', pattern: '/settings', title: 'Settings', screen: SettingsScreen },
  { name: 'task', pattern: '/task/:taskId', title: 'Task', overlay: true, screen: TaskDetail },
];

/** The side panel's screens (src/side-panel.js panelShows). "Add a task" is one form kept while the panel is open. */
const PANEL_ROUTES = [
  { name: 'today', pattern: '/', title: 'Today', screen: TodayScreen },
  { name: 'my-tasks', pattern: '/my-tasks', title: 'My Tasks', screen: MyTasksScreen },
  { name: 'add', pattern: '/add', title: 'Add a task', screen: (ctx) => ctx.panelAddForm() },
  { name: 'task', pattern: '/task/:taskId', title: 'Task', overlay: true, screen: TaskDetail },
];
const SHOWN_ROUTES = PANEL ? PANEL_ROUTES : ROUTES;

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
    if (PANEL) {
      // The side panel signs in through the full app (one place for the server and the password);
      // it shows itself again once someone has signed in there.
      const frame = { openApp: (hash) => openAppTab(chrome, hash), close: () => {}, inPanel: true };
      mount(root, SignedOutView(frame, takeNotice() || 'Sign in to MICO360 Tasks to see your tasks here.'));
      return;
    }
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
    // Chat text not sent yet, per conversation, for this person (memory only; gone on sign-out).
    this.chatDrafts = createChatDrafts(sessionStore, this.me.id);
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
      chatDrafts: this.chatDrafts,
      params: params || {},
      query: query || {},
      isOnline: () => this.state.online,
      navigate: (hash) => { window.location.hash = hash; },
      // Keep the screen's place in the address without drawing it again (the calendar's view and
      // day); the task drawer closes back to it.
      replaceHash: (hash) => {
        window.history.replaceState(null, '', hash);
        this.contentBase = hash;
      },
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
      // The side panel's "Add a task" (one form, kept while the panel is open).
      panelAddForm: () => this.panelAddForm(),
    };
  }

  /**
   * The side panel's new-task form: the popup's (QuickAddForm) with the app's online-first write —
   * sent now, or kept in the queue with the task's own Idempotency-Key; a task with files is never
   * queued. Built once and kept while the panel is open, so moving between its tabs keeps what was
   * typed and the files picked (what was typed is also kept for when the panel opens again).
   * "Open it" and recent tasks open the task's panel here; other pages open in the full app page.
   */
  panelAddForm() {
    if (this.addForm) return this.addForm;
    const app = this;
    this.addForm = QuickAddForm({
      api: this.api,
      me: this.me,
      local: this.storage,
      session: sessionStore,
      appBase: this.appBase,
      apiBase: this.apiBase,
      get timeZone() { return app.timeZone; },
      isOnline: () => this.state.online,
      newKey: newIdempotencyKey,
      send: (kind, payload, opts) => this.write(kind, payload, opts),
      inPanel: true,
      // What was typed is kept for this window's side panel (two windows' panels keep one each).
      panelDraftKey: () => chrome.windows.getCurrent().then((w) => panelDraftKey(w && w.id)),
      capture: null,
      currentPage: async () => null,
      openApp: (hash) => { if (hash) window.location.hash = hash; else return openAppTab(chrome, ''); },
      close: () => {},
    });
    return this.addForm;
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
    // Ctrl+K (⌘K) searches, as on the website — over the task panel too; with search open, back to
    // its box. Chrome never gets the keys (its Ctrl+K would put focus in the address bar). Not over
    // a dialog the screen waits on (a board's New task form): a result would wait for it, then jump.
    document.addEventListener('keydown', (e) => {
      searchShortcut(e, { doc: document, open: () => openSearch(this.ctx({}, {})), blocked: () => this.hold.busy() });
    });
    window.addEventListener('online', () => { this.state.online = true; this.renderStatus(); this.sync(); });
    window.addEventListener('offline', () => { this.state.online = false; this.renderStatus(); });
    // No live connection: coming back to the tab reloads task screens, so changes made elsewhere
    // (such as the next copy of a recurring task) appear.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const matched = matchRoute(SHOWN_ROUTES, parseHash(window.location.hash).path);
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
    setInterval(() => {
      // The side panel stays open beside your work, so its list reads itself again with the counts
      // every minute while it is on screen (no live connection), in place — never under a dialog.
      // While it is hidden nothing is asked (coming back reads Today and My Tasks again).
      if (PANEL && document.visibilityState !== 'visible') return;
      this.refreshMeta();
      if (PANEL && PANEL_LIVE_ROUTES.has(this.routeName())) this.refresh();
    }, 60000);
    // The window this tab is in, so "Open the side panel" opens it straight from the click.
    if (!PANEL && canOpenSidePanel(chrome)) {
      const where = () => chrome.windows.getCurrent().then((w) => { this.windowId = w && w.id; }, () => {});
      void where();
      window.addEventListener('focus', () => { void where(); }); // the tab may have moved to another window
    }
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
    if (PANEL) return; // the side panel shows no name and no admin pages
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

  /** The side panel's frame (app/panel-shell.js): its header, tabs, offline bar and live region. */
  renderPanelShell() {
    const shell = PanelShell({ onOpenApp: () => { void openAppTab(chrome, ''); } });
    this.panelShell = shell;
    this.titleEl = shell.titleEl;
    this.connEl = shell.connEl;
    this.offbar = shell.offbar;
    this.content = shell.content;
    this.live = shell.live;
    mount(this.root, shell.node);
    this.renderStatus();
  }

  renderShell() {
    if (PANEL) {
      this.renderPanelShell();
      return;
    }
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
    const searchBtn = el('button', {
      class: 'btn sm top-search', type: 'button', 'aria-label': 'Search', 'aria-keyshortcuts': 'Control+K Meta+K',
      title: `Search tasks, projects, people and meetings (${MAC ? '⌘K' : 'Ctrl+K'})`, onClick: () => this.showSearch(),
    }, svgIcon(SEARCH_ICON, 15, 2), el('span', { class: 'top-search-label', 'aria-hidden': 'true' }, 'Search'),
    el('kbd', { class: 'top-search-kbd', 'aria-hidden': 'true' }, MAC ? '⌘K' : 'Ctrl K'));
    this.offbar = el('div', { class: 'offbar hidden' }, 'Offline — showing saved data. Changes will sync when you reconnect.');
    this.content = el('div', { class: 'content' });
    this.live = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    // Stage 7: Today, My Tasks and Add a task in Chrome's side panel, beside any page. Asked straight
    // from the click (in this tab's window, or Chrome's current one while that isn't known yet); when
    // Chrome doesn't open it, the page says so.
    this.topNote = el('div', { class: 'top-note' });
    const panelBtn = canOpenSidePanel(chrome)
      ? el('button', {
        class: 'btn sm top-panel', type: 'button', 'aria-label': 'Open the side panel', title: 'Show your tasks beside the page you are on',
        onClick: () => { void openSidePanel(chrome, this.windowId).then((opened) => this.panelOpened(opened, panelBtn)); },
      }, svgIcon(SIDE_PANEL_ICON, 15, 2))
      : null;
    const main = el('main', { class: 'main' },
      el('div', { class: 'topbar' }, this.titleEl, el('span', { class: 'sp' }), panelBtn, searchBtn, this.connEl),
      this.topNote,
      this.offbar,
      this.content,
      this.live,
    );
    mount(this.root, el('div', { class: 'app' }, sidebar, main));
    this.renderStatus();
  }

  /** "Open the side panel" was answered: say so when Chrome didn't open it (Dismiss goes back to the button). */
  panelOpened(opened, button) {
    if (opened) {
      mount(this.topNote);
      return;
    }
    mount(this.topNote, el('div', { class: 'errbar', role: 'alert' },
      el('span', {}, PANEL_FAILED_MESSAGE),
      el('button', { class: 'btn sm', type: 'button', onClick: () => { mount(this.topNote); if (button) button.focus(); } }, 'Dismiss')));
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

  setActiveNav(path, title) {
    if (PANEL) {
      this.panelShell.setActive(path, title);
      return;
    }
    if (path.startsWith('/meeting/')) path = '/meetings'; // a meeting's page is under Meetings
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
    const matched = matchRoute(SHOWN_ROUTES, parseHash(this.contentBase || window.location.hash).path);
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

  /** The search dialog (Ctrl+K, or the Search button). Not over another dialog. Resolves whether it opened. */
  showSearch() {
    if (modalOpen(document)) return false;
    openSearch(this.ctx({}, {}));
    return true;
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
    if (PANEL) {
      // A page the side panel doesn't show (a board, a meeting, Settings…) opens in the full app
      // page; the side panel stays on what it showed (a task's panel stays open).
      const elsewhere = !matchRoute(PANEL_ROUTES, path) && matchRoute(ROUTES, path);
      if (elsewhere && !panelShows(elsewhere.route.name)) {
        void openAppTab(chrome, window.location.hash);
        window.history.replaceState(null, '', this.shownHash || '#/');
        return;
      }
    }
    const matched = matchRoute(SHOWN_ROUTES, path) || { route: SHOWN_ROUTES[0], params: {} };
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
      this.shownHash = window.location.hash;
      // A modal dialog: focus moves in and stays in, the page behind is inert, Escape closes it.
      this.releaseModal = showModal(this.overlay, { onEscape: () => this.closeOverlay(true) });
      return;
    }
    const opener = this.opener; // set while a drawer is (or just was) open
    this.opener = null;
    this.closeOverlay();
    this.contentBase = window.location.hash || '#/';
    this.shownHash = this.contentBase;
    this.titleEl.textContent = route.title;
    this.setActiveNav(path, route.title);
    if (this.topNote) mount(this.topNote); // "Couldn't open the side panel" was about the page before
    const keptForm = PANEL && route.name === 'add' ? this.addForm : null;
    if (keptForm && this.content.firstElementChild === keptForm) {
      // The side panel's kept form is on screen already (back from a task's panel, or the company's
      // time zone arriving): it stays as it is — focus stays in the field being typed in.
      if (opener) returnFocus(this.content, opener);
      return;
    }
    clear(this.content);
    try {
      const node = route.screen(this.ctx(params, query));
      this.content.append(node);
    } catch (e) {
      this.content.append(el('div', { class: 'errbar' }, `Screen error: ${e.message}`));
    }
    // The kept form shown again (its tab chosen): its projects, columns and team are read again.
    if (keptForm && typeof keptForm.refresh === 'function') keptForm.refresh();
    // Back from the drawer: focus the card or row that opened it once the screen has drawn it again.
    if (opener) returnFocus(this.content, opener);
    else if (PANEL && route.name === 'add') this.focusAddForm();
  }

  /** The side panel's "Add a task" tab was chosen: start in the title, as the popup does. */
  focusAddForm() {
    const a = document.activeElement;
    if (a && a !== document.body && !a.closest('.panel-tabs')) return;
    const title = this.content.querySelector('#qa-title');
    if (title) title.focus();
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
