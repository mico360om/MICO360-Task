// @vitest-environment jsdom
/**
 * Stage 7 review fixes in the app itself: app/app.js started in jsdom (the side panel's layout, or
 * the full app page) with stand-ins for Chrome and the server. The side panel's minute while it is
 * hidden, its Add tab shown again, the company's time zone arriving while you type, Ctrl+K over a
 * board's New task dialog, and the app's "Open the side panel" button.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fakeStorage, fakeJwt } from './test-helpers.js';
import { DEFAULTS } from './config.js';

const settle = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};
async function until(fn, tries = 400) {
  for (let i = 0; i < tries; i += 1) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('timed out waiting');
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const PROJ = [{ id: 'p1', name: 'Ops', code: 'OPS', status: 'ACTIVE' }];

/** chrome.storage.<name>: a stand-in whose writes are heard by chrome.storage.onChanged and its own onChanged. */
function area(name, init, bus) {
  const s = fakeStorage(init);
  const own = [];
  const fire = (changes) => {
    if (!Object.keys(changes).length) return;
    for (const l of own) l(changes);
    for (const l of bus) l(changes, name);
  };
  return {
    data: s.data,
    get: s.get,
    async set(obj) {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { oldValue: s.data[k], newValue: v }]));
      await s.set(obj);
      fire(changes);
    },
    async remove(keys) {
      const ks = Array.isArray(keys) ? keys : [keys];
      const changes = Object.fromEntries(ks.filter((k) => k in s.data).map((k) => [k, { oldValue: s.data[k] }]));
      await s.remove(keys);
      fire(changes);
    },
    onChanged: { addListener: (fn) => own.push(fn), removeListener: () => {} },
  };
}

const undo = [];
afterEach(async () => {
  for (const u of undo.splice(0).reverse()) u();
  vi.useRealTimers();
  await settle();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.layout;
});

/** Listeners the app adds to `target` while a test runs are taken off afterwards. */
function track(target) {
  const orig = target.addEventListener;
  const added = [];
  target.addEventListener = function add(type, fn, opts) {
    added.push([type, fn, opts]);
    return orig.call(this, type, fn, opts);
  };
  undo.push(() => {
    target.addEventListener = orig;
    for (const [t, f, o] of added) target.removeEventListener(t, f, o);
  });
}

function setHidden(hidden) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  undo.push(() => { delete document.visibilityState; });
}

/**
 * Start app/app.js as Chrome would: `panel` (app/panel.html) or the full app page, at `hash`, signed
 * in as "me". `server`: replies by path (a value, or a function giving one); any other GET is [].
 */
async function boot({ panel = true, hash = '#/', server = {}, local = {}, chrome: over = {} } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  if (panel) document.documentElement.dataset.layout = 'panel';
  else delete document.documentElement.dataset.layout;
  window.history.replaceState(null, '', hash);
  const bus = [];
  const L = area('local', {
    refreshToken: 'r', sessionUserId: 'me', sessionApiBase: DEFAULTS.apiBase, cacheOwner: 'me',
    sessionUser: { id: 'me', username: 'mariam', email: 'mariam@example.com', roles: [] }, ...local,
  }, bus);
  const S = area('session', { accessToken: fakeJwt('me') }, bus);
  const chrome = {
    storage: { local: L, session: S, onChanged: { addListener: (fn) => bus.push(fn) } },
    runtime: {
      getManifest: () => ({ version: '1.6.0' }),
      sendMessage: vi.fn(async () => ({ skipped: true })),
      getURL: (p) => `chrome-extension://abc/${p}`,
      getContexts: vi.fn(async () => []),
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    notifications: { clear: vi.fn() },
    windows: { getCurrent: vi.fn(async () => ({ id: 7 })), update: vi.fn(async () => {}), WINDOW_ID_CURRENT: -2, ...over.windows },
    tabs: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    sidePanel: { open: vi.fn(async () => {}), ...over.sidePanel },
  };
  globalThis.chrome = chrome;
  undo.push(() => { delete globalThis.chrome; });
  const replies = {
    '/config': { timeZone: 'Asia/Muscat' }, '/notifications/unread-count': { count: 0 }, '/users/directory': [],
    '/tasks/mine': [], '/projects': PROJ, ...server,
  };
  const fetchMock = vi.fn(async (url, init = {}) => {
    const p = new URL(url).pathname.replace(/^\/api\/v1/, '');
    let body = typeof replies[p] === 'function' ? await replies[p](init) : replies[p];
    if (body === undefined) body = init.method && init.method !== 'GET' ? {} : [];
    return new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  undo.push(() => { globalThis.fetch = realFetch; });
  track(window);
  track(document);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.resetModules();
  await import('../app/app.js');
  await until(() => document.querySelector(panel ? '.panel-app' : '.app'));
  await settle();
  const calls = (path) => fetchMock.mock.calls.filter(([u]) => new URL(u).pathname.endsWith(path)).length;
  return { chrome, local: L, session: S, replies, calls };
}

describe('the side panel (app/app.js in its panel layout)', () => {
  it('review fix #5: while the side panel is hidden, the minute doesn’t ask the server for the unread count', async () => {
    const t = await boot();
    const before = t.calls('/notifications/unread-count');
    setHidden(true);
    vi.advanceTimersByTime(60000);
    await settle();
    expect(t.calls('/notifications/unread-count')).toBe(before);
    setHidden(false);
    vi.advanceTimersByTime(60000);
    await settle();
    expect(t.calls('/notifications/unread-count')).toBe(before + 1);
  });

  it('review fix #3: the Add tab shown again reads the projects again (one made since is there to choose)', async () => {
    const t = await boot({ hash: '#/add' });
    await until(() => document.querySelectorAll('#qa-project option').length === 1 && document.querySelector('#qa-project').value === 'p1');
    window.location.hash = '#/';
    await until(() => document.querySelector('.today-head'));
    t.replies['/projects'] = [...PROJ, { id: 'p2', name: 'Pipeline', code: 'PIP', status: 'ACTIVE' }];
    window.location.hash = '#/add';
    await until(() => document.querySelector('.qa-in-panel'));
    await settle();
    expect([...document.querySelectorAll('#qa-project option')].map((o) => o.textContent)).toEqual(['Ops · OPS', 'Pipeline · PIP']);
  });

  it('review fix #2: what is typed in the Add tab is kept for this window’s side panel (its own key)', async () => {
    const t = await boot({ hash: '#/add' });
    const title = await until(() => document.getElementById('qa-title'));
    title.value = 'Half typed';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(t.session.data['mico360.quickAdd.panelDraft:7']).toMatchObject({ userId: 'me', fields: { title: 'Half typed' } });
    expect(t.session.data['mico360.quickAdd.panelDraft']).toBeUndefined();
  });

  it('review fix #12: the company’s time zone arriving late leaves the Add tab’s form where it is — focus stays in the field being typed in', async () => {
    const config = deferred();
    const t = await boot({ hash: '#/add', local: { companyTimeZone: 'UTC' }, server: { '/config': () => config.promise } });
    const desc = await until(() => document.getElementById('qa-desc'));
    const form = document.querySelector('.qa-in-panel');
    desc.focus();
    desc.value = 'Half typed';
    config.resolve({ timeZone: 'Asia/Muscat' });
    await until(() => t.local.data.companyTimeZone === 'Asia/Muscat');
    await settle();
    expect(document.querySelector('.qa-in-panel')).toBe(form);
    expect(document.activeElement).toBe(desc);
  });
});

describe('the full app page (app/app.js)', () => {
  const ctrlK = (target) => {
    const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };

  it('review fix #4: Ctrl+K over a board’s New task dialog opens nothing (no result waiting to jump once it closes)', async () => {
    await boot({ panel: false, hash: '#/my-tasks' });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = document.createElement('input');
    dialog.append(title);
    document.body.append(dialog);
    title.focus();
    const e = ctrlK(title);
    expect(e.defaultPrevented).toBe(true);
    expect(document.querySelector('.search-dialog')).toBeNull();
    expect(document.activeElement).toBe(title);
    dialog.remove();
    const again = ctrlK(document.body); // no dialog: search opens
    expect(again.defaultPrevented).toBe(true);
    expect(document.querySelector('.search-dialog')).toBeTruthy();
  });

  it('review fix #8: “Open the side panel” before the window is known opens it in this window, inside the click', async () => {
    const t = await boot({ panel: false, hash: '#/my-tasks', chrome: { windows: { getCurrent: vi.fn(() => new Promise(() => {})) } } });
    document.querySelector('[aria-label="Open the side panel"]').click();
    expect(t.chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: -2 });
  });

  it('review fix #8: …and says so when Chrome doesn’t open it', async () => {
    const t = await boot({ panel: false, hash: '#/my-tasks', chrome: { sidePanel: { open: vi.fn(async () => { throw new Error('Not allowed.'); }) } } });
    await settle();
    document.querySelector('[aria-label="Open the side panel"]').click();
    await settle();
    expect(t.chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
    const alert = [...document.querySelectorAll('[role="alert"]')].find((n) => n.textContent.includes('Couldn’t open the side panel'));
    expect(alert).toBeTruthy();
  });
});
