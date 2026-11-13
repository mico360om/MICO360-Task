import { describe, it, expect, vi, afterEach } from 'vitest';
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

function worker(opts: { kill?: boolean; net?: Net; putFails?: boolean } = {}) {
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
      put: async (k: string | FakeRequest, res: Response) => {
        if (opts.putFails) throw new DOMException('quota', 'QuotaExceededError');
        m.set(keyOf(k), res);
      },
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
  const fetchedWith: { path: string; cache?: string }[] = [];
  const fetchFn = async (input: string | FakeRequest, init?: { cache?: string }) => {
    const url = typeof input === 'string' ? new URL(input, ORIGIN).href : input.url;
    fetched.push(new URL(url).pathname);
    fetchedWith.push({ path: new URL(url).pathname, cache: init?.cache });
    return net(url);
  };
  const source = opts.kill ? SOURCE.replace('const KILL_SWITCH = false;', 'const KILL_SWITCH = true;') : SOURCE;
  // A stand-in URLPattern (the worker only builds them for its routes).
  class URLPattern {
    constructor(public init: { pathname: string }) {}
  }
  // Timers through the test's own (so fake timers reach the worker).
  const timers = { setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms), clearTimeout: (t: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(t) };
  vm.runInContext(source, vm.createContext({ self, caches, fetch: fetchFn, URL, URLPattern, Response, Headers, console, ...timers }));

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
  return { self, stores, fetched, fetchedWith, navigated, lifecycle, request, message, setNet: (n: Net) => void (net = n) };
}

const html = (body = '<script type="module" src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-abc.css">') =>
  new Response(`<!doctype html><html><head>${body}</head></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const js = (text = 'console.log(1)') => new Response(text, { status: 200, headers: { 'content-type': 'text/javascript' } });
const offline: Net = () => Promise.reject(new TypeError('Failed to fetch'));
/** What v2 keeps besides the page and its files (the worker's own list). */
const KEPT_SOURCE = /const KEPT = (\[[^\]]+\]);/.exec(SOURCE)?.[1];
const KEPT: string[] = KEPT_SOURCE ? (JSON.parse(KEPT_SOURCE.replace(/'/g, '"')) as string[]) : [];

describe('the service worker (public/sw.js)', () => {
  it('on install keeps the page and the files it loads first, and takes over at once', async () => {
    const w = worker({ net: (url) => (url.endsWith('/') ? html() : js()) });
    await w.lifecycle('install');
    expect(w.fetched.slice(0, 3)).toEqual(['/', '/assets/index-abc.js', '/assets/index-abc.css']);
    expect([...w.stores.get('mico360-shell-v2')!.keys()]).toContain('/__mico360-shell__');
    expect([...w.stores.get('mico360-assets-v2')!.keys()]).toEqual(['/assets/index-abc.js', '/assets/index-abc.css']);
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });

  // PWA (13 Nov): the cache version is v2, and installing also keeps the offline page, the manifest and
  // the icons — those only (never an API answer, a file or anything personal).
  it('v2: on install also keeps the offline page, the manifest and the icons — nothing else', async () => {
    const w = worker({ net: (url) => (url.endsWith('/') ? html() : js()) });
    await w.lifecycle('install');
    expect(KEPT).toEqual(['/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/apple-touch-icon.png']);
    expect([...w.stores.get('mico360-shell-v2')!.keys()].sort()).toEqual(['/__mico360-shell__', ...KEPT].sort());
    expect([...w.stores.keys()].sort()).toEqual(['mico360-assets-v2', 'mico360-shell-v2']);
    // Fetched fresh, never from the browser's HTTP cache.
    expect(w.fetchedWith.filter((f) => KEPT.includes(f.path)).every((f) => f.cache === 'no-store')).toBe(true);
  });

  it('v2: a kept file the server can’t give (404, no signal) is simply not kept; installing still finishes', async () => {
    const w = worker({ net: (url) => (url.endsWith('/') ? html() : url.endsWith('.png') ? new Response('no', { status: 404 }) : js()) });
    await w.lifecycle('install');
    expect([...w.stores.get('mico360-shell-v2')!.keys()].sort()).toEqual(['/__mico360-shell__', '/manifest.webmanifest', '/offline.html']);
    const off = worker({ net: offline });
    await off.lifecycle('install');
    expect(off.self.skipWaiting).toHaveBeenCalled();
  });

  it('v2: the manifest and icons come from the network when it answers (and are kept up to date), else from the cache', async () => {
    const w = worker({ net: () => js('icon v1') });
    await w.lifecycle('install');
    w.setNet(() => js('icon v2'));
    expect(await (await w.request('/icons/icon-192.png'))!.text()).toBe('icon v2');
    w.setNet(offline);
    expect(await (await w.request('/icons/icon-192.png'))!.text()).toBe('icon v2');
    expect(await (await w.request('/manifest.webmanifest'))!.text()).toBe('icon v1');
    // A kept file never kept: offline, it fails as it would without the worker.
    const empty = worker({ net: offline });
    await expect(empty.request('/manifest.webmanifest')).rejects.toThrow('Failed to fetch');
    // A server error is passed on and the kept copy stays.
    w.setNet(() => new Response('oops', { status: 500 }));
    expect((await w.request('/manifest.webmanifest'))!.status).toBe(500);
    w.setNet(offline);
    expect(await (await w.request('/manifest.webmanifest'))!.text()).toBe('icon v1');
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

  // PWA: a page load that fails with no saved page shows the offline page ("You're offline…"); the last
  // good page still comes first.
  it('v2: without signal and no last good page, the offline page; with one, the last good page first', async () => {
    const w = worker({ net: (url) => (url.endsWith('/offline.html') ? new Response('<title>You’re offline</title>', { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('nothing', { status: 404 })) });
    await w.lifecycle('install');
    expect([...w.stores.get('mico360-shell-v2')!.keys()]).not.toContain('/__mico360-shell__');
    w.setNet(offline);
    const page = await w.request('/inspections/i1', { mode: 'navigate' });
    expect(await page!.text()).toContain('You’re offline');
    // Once a page has loaded, it is what comes back without signal (inspections keep working).
    w.setNet(() => html('<title>app</title>'));
    await w.request('/inspections/i1', { mode: 'navigate' });
    w.setNet(offline);
    expect(await (await w.request('/projects', { mode: 'navigate' }))!.text()).toContain('app');
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
    for (const path of ['/api/v1/inspections/i1', '/client/abc', '/uploads/p/rig.png', '/downloads/MICO360-Tasks.apk', '/socket.io/?EIO=4', '/email-assets/logo.png', '/build-info.json', '/sw.js', '/favicon.svg', '/robots.txt', '/icons/other.png']) {
      expect(await w.request(path), path).toBeNull();
    }
    expect(await w.request('/client/abcdef', { mode: 'navigate' })).toBeNull();
    expect(await w.request('/assets/x.js', { method: 'POST' })).toBeNull();
    expect(await w.request('/assets/x.js', { origin: 'https://cdn.example' })).toBeNull();
  });

  it('on activate removes older caches of its own (only its own, v1 too) and takes over open pages', async () => {
    const w = worker();
    w.stores.set('mico360-assets-v0', new Map());
    w.stores.set('mico360-assets-v1', new Map());
    w.stores.set('someone-else', new Map());
    w.stores.set('mico360-shell-v1', new Map());
    w.stores.set('mico360-shell-v2', new Map());
    await w.lifecycle('activate');
    expect([...w.stores.keys()].sort()).toEqual(['mico360-shell-v2', 'someone-else']);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it('v2: opening the offline page itself never replaces the last good page', async () => {
    const w = worker({ net: () => html('<title>app</title>') });
    await w.request('/inspections/i1', { mode: 'navigate' });
    w.setNet(() => new Response('<title>You’re offline</title>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await (await w.request('/offline.html', { mode: 'navigate' }))!.text()).toContain('offline');
    w.setNet(offline);
    expect(await (await w.request('/inspections/i1', { mode: 'navigate' }))!.text()).toContain('app');
  });

  // Review (13 Nov): a new worker installing while a page of the older build is open (the browser's own
  // update check) must not swap the last good page for the new build's: the open page's code is what was
  // kept, and an inspection reloaded offline must find it. The next real page load updates it.
  it('installing again keeps the last good page there is (its files still fetched); the first install keeps one', async () => {
    const w = worker({ net: (url) => (url.endsWith('/') ? html('<title>new</title><script type="module" src="/assets/index-new.js"></script>') : js()) });
    w.stores.set('mico360-shell-v2', new Map([['/__mico360-shell__', html('<title>old</title>')]]));
    await w.lifecycle('install');
    expect(await w.stores.get('mico360-shell-v2')!.get('/__mico360-shell__')!.clone().text()).toContain('old');
    expect([...w.stores.get('mico360-assets-v2')!.keys()]).toContain('/assets/index-new.js');
    // A last good page kept by the older worker (v1) counts too (activate carries it over).
    const older = worker({ net: (url) => (url.endsWith('/') ? html('<title>new</title>') : js()) });
    older.stores.set('mico360-shell-v1', new Map([['/__mico360-shell__', html('<title>old</title>')]]));
    await older.lifecycle('install');
    expect(older.stores.get('mico360-shell-v2')!.has('/__mico360-shell__')).toBe(false);
  });

  // Review (13 Nov): the cache rename (v1 → v2) must not lose what the older worker kept — the last good
  // page and the app's files (a page loaded just before the new worker took over put its code in v1).
  it('on activate carries the last good page and the kept /assets/ from its older caches, then removes them', async () => {
    const w = worker();
    w.stores.set('mico360-shell-v1', new Map([['/__mico360-shell__', html('<title>old</title>')]]));
    w.stores.set('mico360-assets-v1', new Map([['/assets/InspectionPage-n.js', js('n')], ['/assets/index-n.js', js('i')]]));
    w.stores.set('mico360-shell-v2', new Map([['/offline.html', html('<title>offline</title>')]]));
    w.stores.set('mico360-assets-v2', new Map([['/assets/index-n.js', js('i2')]]));
    await w.lifecycle('activate');
    expect([...w.stores.keys()].sort()).toEqual(['mico360-assets-v2', 'mico360-shell-v2']);
    expect(await w.stores.get('mico360-shell-v2')!.get('/__mico360-shell__')!.clone().text()).toContain('old');
    expect([...w.stores.get('mico360-assets-v2')!.keys()].sort()).toEqual(['/assets/InspectionPage-n.js', '/assets/index-n.js']);
    // What the new caches already hold wins.
    expect(await w.stores.get('mico360-assets-v2')!.get('/assets/index-n.js')!.clone().text()).toBe('i2');
    const kept = worker();
    kept.stores.set('mico360-shell-v1', new Map([['/__mico360-shell__', html('<title>old</title>')]]));
    kept.stores.set('mico360-shell-v2', new Map([['/__mico360-shell__', html('<title>current</title>')]]));
    await kept.lifecycle('activate');
    expect(await kept.stores.get('mico360-shell-v2')!.get('/__mico360-shell__')!.clone().text()).toContain('current');
  });

  // Self-review (13 Nov): a phone that used the app for months has a full v1 cache (300 files). Carrying it
  // all over and then trimming oldest-first would drop the new build's own files: only what fits comes
  // along, the newest first, and the current build's files stay.
  it('carries over only what fits (the newest), never pushing out the current build’s files', async () => {
    const w = worker();
    const old = new Map<string, Response>();
    for (let i = 0; i < 300; i++) old.set(`/assets/old-${String(i).padStart(3, '0')}.js`, js(`o${i}`));
    w.stores.set('mico360-assets-v1', old);
    w.stores.set('mico360-assets-v2', new Map([['/assets/index-new.js', js('new')], ['/assets/vendor-new.js', js('vendor')]]));
    await w.lifecycle('activate');
    const kept = [...w.stores.get('mico360-assets-v2')!.keys()];
    expect(kept).toHaveLength(300);
    expect(kept).toContain('/assets/index-new.js');
    expect(kept).toContain('/assets/vendor-new.js');
    // The newest of the old ones came along; the two oldest didn't.
    expect(kept).toContain('/assets/old-299.js');
    expect(kept).not.toContain('/assets/old-000.js');
    expect(kept).not.toContain('/assets/old-001.js');
  });

  it('a kept file the cache refuses to store (full) is still answered from the network', async () => {
    const w = worker({ net: () => js('fresh'), putFails: true });
    expect(await (await w.request('/manifest.webmanifest'))!.text()).toBe('fresh');
  });

  // Review (13 Nov): the last good page is kept without the address it came from (a password-reset link's
  // token in /reset?token=… must not stay in the cache's records).
  it('keeps the last good page without the address it was loaded from', async () => {
    const w = worker({
      net: (url) => {
        // A browser's answer knows its address, and so does its copy.
        const withUrl = (r: Response): Response => {
          const clone = r.clone.bind(r);
          Object.defineProperty(r, 'url', { value: url });
          Object.defineProperty(r, 'clone', { value: () => withUrl(clone()) });
          return r;
        };
        return withUrl(html('<title>app</title>'));
      },
    });
    const page = await w.request('/reset?token=secret-token', { mode: 'navigate' });
    expect(await page!.text()).toContain('app');
    const kept = w.stores.get('mico360-shell-v2')!.get('/__mico360-shell__')!;
    expect(kept.url).not.toContain('secret-token');
    expect(kept.headers.get('content-type')).toMatch(/text\/html/);
  });

  // Coordinator follow-up (13 Nov): a new worker waits until the old one has nothing in progress. One
  // request the server never answers (a dropped connection on a phone, a stuck proxy) kept every update —
  // and the kill switch — out until the browser closed (reproduced in Chrome). Every wait now has an end.
  describe('nothing it waits for can hold up an update', () => {
    const never = () => new Promise<Response>(() => {});
    afterEach(() => vi.useRealTimers());

    it('a page load the server never answers: the last good page after 30 s (the offline page if none)', async () => {
      vi.useFakeTimers();
      const w = worker({ net: () => html('<title>kept</title>') });
      await w.request('/projects', { mode: 'navigate' });
      w.setNet(never);
      const page = w.request('/inspections/i1', { mode: 'navigate' });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await (await page)!.text()).toContain('kept');
      const fresh = worker({ net: (url) => (url.endsWith('/offline.html') ? new Response('<title>You’re offline</title>', { status: 200, headers: { 'content-type': 'text/html' } }) : html()) });
      await fresh.lifecycle('install');
      fresh.stores.get('mico360-shell-v2')!.delete('/__mico360-shell__');
      fresh.setNet(never);
      const offlinePage = fresh.request('/x', { mode: 'navigate' });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await (await offlinePage)!.text()).toContain('offline');
    });

    it('an app file the server never answers: fails after 60 s, as a dropped connection would', async () => {
      vi.useFakeTimers();
      const w = worker({ net: never });
      const file = w.request('/assets/never-1.js');
      const failed = expect(file).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60_000);
      await failed;
    });

    it('the manifest or an icon the server never answers: the kept copy after 30 s', async () => {
      vi.useFakeTimers();
      const w = worker({ net: () => js('kept icon') });
      await w.request('/icons/icon-192.png');
      w.setNet(never);
      const icon = w.request('/icons/icon-192.png');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await (await icon)!.text()).toBe('kept icon');
    });

    it('keeping the page’s files (its message) and installing end within 30 s whatever the server does', async () => {
      vi.useFakeTimers();
      const w = worker({ net: never });
      let kept = false;
      void w.message({ type: 'cache-assets', urls: ['/assets/a.js'] }).then(() => (kept = true));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(kept).toBe(true);
      let installed = false;
      void w.lifecycle('install').then(() => (installed = true));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(installed).toBe(true);
      expect(w.self.skipWaiting).toHaveBeenCalled();
    });

    it('an answer in time is used as before (nothing waits for the timer)', async () => {
      vi.useFakeTimers();
      const w = worker({ net: () => html('<title>fresh</title>') });
      expect(await (await w.request('/projects', { mode: 'navigate' }))!.text()).toContain('fresh');
    });
  });

  it('the never list is unchanged by v2 (the API, client pages, uploads, downloads, realtime, email pictures)', () => {
    const never = /const NEVER = \[(.+)\];/.exec(SOURCE)?.[1];
    expect(never).toBe(String.raw`/^\/api\//, /^\/client(\/|$)/, /^\/uploads\//, /^\/downloads\//, /^\/socket\.io\//, /^\/email-assets\//`);
    expect(SOURCE).toContain("const VERSION = 'v2';");
  });

  it('keeps the files a page loaded before it took over (its own /assets/ only)', async () => {
    const w = worker({ net: () => js() });
    await w.message({ type: 'cache-assets', urls: [`${ORIGIN}/assets/a.js`, '/assets/b.css', 'https://cdn.example/assets/c.js', '/api/v1/me', 'not a url ::'] });
    expect([...w.stores.get('mico360-assets-v2')!.keys()]).toEqual(['/assets/a.js', '/assets/b.css']);
  });

  it('the kill switch: removes its caches, unregisters, reloads the pages and handles nothing', async () => {
    const w = worker({ kill: true, net: () => html() });
    w.stores.set('mico360-shell-v1', new Map([['/__mico360-shell__', html()]]));
    w.stores.set('mico360-shell-v2', new Map([['/offline.html', html()], ['/manifest.webmanifest', js()]]));
    w.stores.set('mico360-assets-v2', new Map([['/assets/a.js', js()]]));
    w.stores.set('someone-else', new Map());
    await w.lifecycle('install');
    expect(w.fetched).toEqual([]);
    await w.lifecycle('activate');
    expect([...w.stores.keys()]).toEqual(['someone-else']);
    expect(w.self.registration.unregister).toHaveBeenCalled();
    expect(w.navigated).toEqual([`${ORIGIN}/inspections/i1`]);
    for (const path of ['/inspections/i1', '/offline.html']) expect(await w.request(path, { mode: 'navigate' }), path).toBeNull();
    for (const path of ['/manifest.webmanifest', '/icons/icon-192.png', '/assets/a.js']) expect(await w.request(path), path).toBeNull();
  });
});
