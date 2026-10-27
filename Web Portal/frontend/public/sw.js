/*
 * MICO360 Tasks service worker. It lets a page that was opened here load again with no signal — an
 * inspection started on a phone keeps working even if the page reloads — and changes nothing else:
 *
 * - Page loads (navigations): the network first, always (so an online person always gets the newest
 *   app); the last good page is kept and used only when the network can't be reached.
 * - The app's files under /assets/ have their content's hash in their names and never change: kept
 *   once fetched, and used from the cache.
 * - Never cached: the API (/api/), the client page (/client/), uploaded files (/uploads/), the
 *   downloads (/downloads/), realtime (/socket.io/), email pictures, and every other request.
 *
 * To switch it off everywhere: deploy this file with KILL_SWITCH = true. Each browser that checks for
 * an update (on its next page load) removes its caches, unregisters it and reloads its pages. One
 * browser can also open any page with ?nosw (the page does the same for itself).
 */
const KILL_SWITCH = false;
/** Changes when the way things are cached changes: older caches are removed when this one starts. */
const VERSION = 'v1';
const PREFIX = 'mico360-';
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const ASSET_CACHE = `${PREFIX}assets-${VERSION}`;
/** Where the last good page (index.html) is kept. */
const SHELL_KEY = '/__mico360-shell__';
/** The app's files kept at most (the oldest go first): a few releases' worth. */
const MAX_ASSETS = 300;
const NEVER = [/^\/api\//, /^\/client(\/|$)/, /^\/uploads\//, /^\/downloads\//, /^\/socket\.io\//, /^\/email-assets\//];

const isAsset = (path) => path.startsWith('/assets/');

/** The page's own files (scripts, styles, its icon and fonts under /assets/), read from its HTML. */
function assetsIn(html) {
  const out = new Set();
  for (const m of String(html).matchAll(/(?:src|href)="(\/assets\/[^"#?]+)"/g)) out.add(m[1]);
  return [...out];
}

async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

async function cacheAssets(urls) {
  const cache = await caches.open(ASSET_CACHE);
  for (const raw of urls || []) {
    let url;
    try {
      url = new URL(raw, self.location.origin);
    } catch {
      continue;
    }
    if (url.origin !== self.location.origin || !isAsset(url.pathname)) continue;
    if (await cache.match(url.pathname)) continue;
    try {
      const res = await fetch(url.pathname, { credentials: 'same-origin' });
      if (res.ok) await cache.put(url.pathname, res);
    } catch {
      /* fetched again when it's needed */
    }
  }
  await trimAssets();
}

/** The page as it is now, and the files it loads first (so a first visit can already load again offline). */
async function cacheShell() {
  try {
    const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await (await caches.open(SHELL_CACHE)).put(SHELL_KEY, res);
    await cacheAssets(assetsIn(html));
  } catch {
    /* no signal while installing: kept on the next page load */
  }
}

async function removeEverything() {
  for (const name of await caches.keys()) if (name.startsWith(PREFIX)) await caches.delete(name);
}

/** A page load: the network first; the last good page only when the network can't be reached. */
async function pageLoad(request) {
  try {
    const res = await fetch(request);
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/html')) {
      await (await caches.open(SHELL_CACHE)).put(SHELL_KEY, res.clone());
      return res;
    }
    // The server answered, but not with the app (a proxy's 502 page while it restarts): the last good
    // page if there is one, else what the server said.
    if (res.status >= 500) {
      const kept = await caches.match(SHELL_KEY);
      if (kept) return kept;
    }
    return res;
  } catch (err) {
    const kept = await caches.match(SHELL_KEY);
    if (kept) return kept;
    throw err;
  }
}

/** One of the app's files: from the cache when it's there (it never changes), else fetched and kept. */
async function appFile(request) {
  const path = new URL(request.url).pathname;
  const cache = await caches.open(ASSET_CACHE);
  const kept = await cache.match(path);
  if (kept) return kept;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(path, res.clone());
    await trimAssets();
  }
  return res;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (!KILL_SWITCH) await cacheShell();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (KILL_SWITCH) {
        await removeEverything();
        await self.registration.unregister();
        for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
        return;
      }
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const name of await caches.keys()) if (name.startsWith(PREFIX) && !keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

// The page sends the files it loaded before this worker took over, so they are kept too.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'cache-assets' && Array.isArray(data.urls) && !KILL_SWITCH) event.waitUntil(cacheAssets(data.urls));
});

self.addEventListener('fetch', (event) => {
  if (KILL_SWITCH) return;
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((re) => re.test(url.pathname))) return;
  if (request.mode === 'navigate') {
    event.respondWith(pageLoad(request));
    return;
  }
  if (isAsset(url.pathname)) event.respondWith(appFile(request));
  // Anything else goes to the network as if there were no worker.
});
