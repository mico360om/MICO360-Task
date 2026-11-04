import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

// The real public/sw.js, run with a fake service-worker world: caches, the network and the pages.
const SOURCE = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://task.mico360.test';

type Net = (url: string) => Response | Promise<Response>;
interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

function worker(opts: { kill?: boolean; net?: Net } = {}) {
  let net: Net = opts.net ?? (() => new Response('nothing', { status: 404 }));
  const fetched: string[] = [];
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (k: string | FakeRequest) => {
    const raw = typeof k === 'string' ? k : k.url;
    return raw.startsWith('http') ? new URL(raw).pathname : raw;
  };
  const cacheOf = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (k: string | FakeRequest) => m.get(keyOf(k))?.clone(),
      put: async (k: string | FakeRequest, res: Response) => void m.set(keyOf(k), res),
      keys: async () => [...m.keys()].map((url) => ({ url: `${ORIGIN}${url}` })),
      delete: async (k: string | FakeRequest) => m.delete(keyOf(k)),
    };
  };
  const caches = {
    open: async (name: string) => cacheOf(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (k: string) => {
      for (const m of stores.values()) if (m.has(keyOf(k))) return m.get(keyOf(k))!.clone();
      return undefined;
    },
  };
  const listeners: Record<string, (e: unknown) => void> = {};
  const navigated: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined), matchAll: async () => [{ url: `${ORIGIN}/inspections/i1`, navigate: (u: string) => void navigated.push(u) }] },
    registration: { unregister: vi.fn(async () => true) },
  };
  const fetchFn = async (input: string | FakeRequest) => {
    const url = typeof input === 'string' ? new URL(input, ORIGIN).href : input.url;
    fetched.push(new URL(url).pathname);
    return net(url);
  };
  const source = opts.kill ? SOURCE.replace('const KILL_SWITCH = false;', 'const KILL_SWITCH = true;') : SOURCE;
  // A stand-in URLPattern (the worker only builds them for its routes).
  class URLPattern {
    constructor(public init: { pathname: string }) {}
  }
  vm.runInContext(source, vm.createContext({ self, caches, fetch: fetchFn, URL, URLPattern, Response, Headers, console }));

  async function lifecycle(type: 'install' | 'activate', extra: Record<string, unknown> = {}) {
    let done: unknown;
    listeners[type]!({ waitUntil: (p: unknown) => void (done = p), ...extra });
    await done;
  }
  /** A request through the worker: its answer, or null when the worker leaves it to the network. */
  async function request(path: string, init: { method?: string; mode?: string; origin?: string } = {}): Promise<Response | null> {
    let answer: Promise<Response> | null = null;
    listeners.fetch!({ request: { url: `${init.origin ?? ORIGIN}${path}`, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }, respondWith: (p: Promise<Response>) => void (answer = p) });
    return answer ? await answer : null;
  }
  async function message(data: unknown) {
    let done: unknown;
    listeners.message!({ data, waitUntil: (p: unknown) => void (done = p) });
    await done;
  }
  return { self, stores, fetched, navigated, lifecycle, request, message, setNet: (n: Net) => void (net = n) };
}

const html = (body = '<script type="module" src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-abc.css">') =>
  new Response(`<!doctype html><html><head>${body}</head></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const js = (text = 'console.log(1)') => new Response(text, { status: 200, headers: { 'content-type': 'text/javascript' } });
const offline: Net = () => Promise.reject(new TypeError('Failed to fetch'));

describe('the service worker (public/sw.js)', () => {
  it('on install keeps the page and the files it loads first, and takes over at once', async () => {
    const w = worker({ net: (url) => (url.endsWith('/') ? html() : js()) });
    await w.lifecycle('install');
    expect(w.fetched).toEqual(['/', '/assets/index-abc.js', '/assets/index-abc.css']);
    expect([...w.stores.get('mico360-shell-v1')!.keys()]).toEqual(['/__mico360-shell__']);
    expect([...w.stores.get('mico360-assets-v1')!.keys()]).toEqual(['/assets/index-abc.js', '/assets/index-abc.css']);
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });

  // 1.22 QA: a request sent as a page goes (a notification's Remove still waiting for its Undo, sent
  // kept-alive on a reload) was lost when the worker had to see it first. What it never handles goes
  // straight to the network now, without waking it (static routing, where the browser has it).
  it('on install sends what it never handles straight to the network, where the browser can', async () => {
    const addRoutes = vi.fn(async () => undefined);
    const w = worker({ net: (url) => (url.endsWith('/') ? html() : js()) });
    await w.lifecycle('install', { addRoutes });
    expect(addRoutes).toHaveBeenCalledTimes(1);
    const routes = (addRoutes.mock.calls[0] as unknown as [Array<{ condition: { urlPattern: { init: { pathname: string } } }; source: string }>])[0];
    expect(routes.every((r) => r.source === 'network')).toBe(true);
    expect(routes.map((r) => r.condition.urlPattern.init.pathname)).toEqual(['/api/*', '/socket.io/*', '/uploads/*', '/downloads/*', '/email-assets/*', '/client', '/client/*']);
    // A browser without static routing: installed as before.
    const older = worker({ net: (url) => (url.endsWith('/') ? html() : js()) });
    await older.lifecycle('install');
    expect(older.self.skipWaiting).toHaveBeenCalled();
    // A browser that refuses the routes: installed all the same.
    const refusing = worker({ net: (url) => (url.endsWith('/') ? html() : js()) });
    await refusing.lifecycle('install', { addRoutes: vi.fn(async () => Promise.reject(new TypeError('no'))) });
    expect(refusing.self.skipWaiting).toHaveBeenCalled();
    // The kill switch adds none.
    const killed = worker({ kill: true });
    const none = vi.fn(async () => undefined);
    await killed.lifecycle('install', { addRoutes: none });
    expect(none).not.toHaveBeenCalled();
  });

  it('page loads: the network first (the newest app), the last good page only without signal', async () => {
    const w = worker({ net: () => html('<title>new</title>') });
    const online = await w.request('/inspections/i1', { mode: 'navigate' });
    expect(await online!.text()).toContain('new');
    w.setNet(offline);
    const offlineLoad = await w.request('/inspections/i1', { mode: 'navigate' });
    expect(await offlineLoad!.text()).toContain('new');
    // A proxy's error page while the server restarts: the last good page.
    w.setNet(() => new Response('Bad gateway', { status: 502, headers: { 'content-type': 'text/html' } }));
    expect(await (await w.request('/projects', { mode: 'navigate' }))!.text()).toContain('new');
  });

  it('without a kept page and without signal, the page load fails as it would without the worker', async () => {
    const w = worker({ net: offline });
    await expect(w.request('/inspections/i1', { mode: 'navigate' })).rejects.toThrow('Failed to fetch');
  });

  it('the app’s files: from the cache once kept (they never change)', async () => {
    const w = worker({ net: () => js('v1') });
    expect(await (await w.request('/assets/InspectionPage-x1.js'))!.text()).toBe('v1');
    w.setNet(offline);
    expect(await (await w.request('/assets/InspectionPage-x1.js'))!.text()).toBe('v1');
    expect(w.fetched.filter((p) => p === '/assets/InspectionPage-x1.js')).toHaveLength(1);
  });

  it('never keeps the API, the client page, uploads, downloads, realtime or anything else', async () => {
    const w = worker({ net: () => js() });
    for (const path of ['/api/v1/inspections/i1', '/client/abc', '/uploads/p/rig.png', '/downloads/MICO360-Tasks.apk', '/socket.io/?EIO=4', '/build-info.json', '/sw.js']) {
      expect(await w.request(path), path).toBeNull();
    }
    expect(await w.request('/client/abcdef', { mode: 'navigate' })).toBeNull();
    expect(await w.request('/assets/x.js', { method: 'POST' })).toBeNull();
    expect(await w.request('/assets/x.js', { origin: 'https://cdn.example' })).toBeNull();
  });

  it('on activate removes older caches of its own (only its own) and takes over open pages', async () => {
    const w = worker();
    w.stores.set('mico360-assets-v0', new Map());
    w.stores.set('someone-else', new Map());
    w.stores.set('mico360-shell-v1', new Map());
    await w.lifecycle('activate');
    expect([...w.stores.keys()].sort()).toEqual(['mico360-shell-v1', 'someone-else']);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it('keeps the files a page loaded before it took over (its own /assets/ only)', async () => {
    const w = worker({ net: () => js() });
    await w.message({ type: 'cache-assets', urls: [`${ORIGIN}/assets/a.js`, '/assets/b.css', 'https://cdn.example/assets/c.js', '/api/v1/me', 'not a url ::'] });
    expect([...w.stores.get('mico360-assets-v1')!.keys()]).toEqual(['/assets/a.js', '/assets/b.css']);
  });

  it('the kill switch: removes its caches, unregisters, reloads the pages and handles nothing', async () => {
    const w = worker({ kill: true, net: () => html() });
    w.stores.set('mico360-shell-v1', new Map([['/__mico360-shell__', html()]]));
    await w.lifecycle('install');
    expect(w.fetched).toEqual([]);
    await w.lifecycle('activate');
    expect([...w.stores.keys()]).toEqual([]);
    expect(w.self.registration.unregister).toHaveBeenCalled();
    expect(w.navigated).toEqual([`${ORIGIN}/inspections/i1`]);
    expect(await w.request('/inspections/i1', { mode: 'navigate' })).toBeNull();
  });
});
