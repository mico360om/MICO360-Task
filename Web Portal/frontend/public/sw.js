/*
 * MICO360 Tasks service worker. It lets a page that was opened here load again with no signal — an
 * inspection started on a phone keeps working even if the page reloads — and changes nothing else:
 *
 * - Page loads (navigations): the network first, always (so an online person always gets the newest
 *   app); the last good page is kept and used only when the network can't be reached.
 * - The app's files under /assets/ have their content's hash in their names and never change: kept
 *   once fetched, and used from the cache.
 * - Installable website (v2): the offline page, the manifest and the app icons (KEPT) are kept when it
 *   installs. A page load with no signal and no last good page shows the offline page; the manifest and
 *   icons come from the network when it answers, else from what was kept. Nothing personal: never an
 *   API answer, an uploaded file or a download.
 * - Never cached: the API (/api/), the client page (/client/), uploaded files (/uploads/), the
 *   downloads (/downloads/), realtime (/socket.io/), email pictures, and every other request.
 *
 * To switch it off everywhere: deploy this file with KILL_SWITCH = true. Each browser that checks for
 * an update (on its next page load) removes its caches, unregisters it and reloads its pages. One
 * browser can also open any page with ?nosw (the page does the same for itself).
 */
const KILL_SWITCH = false;
/** Changes when the way things are cached changes: older caches are removed when this one starts. */
const VERSION = 'v2';
const PREFIX = 'mico360-';
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const ASSET_CACHE = `${PREFIX}assets-${VERSION}`;
/** Where the last good page (index.html) is kept. */
const SHELL_KEY = '/__mico360-shell__';
/** The app's files kept at most (the oldest go first): a few releases' worth. */
const MAX_ASSETS = 300;
/** Kept when it installs (v2), besides the page and its files: the offline page, the manifest and the icons. */
const KEPT = ['/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/apple-touch-icon.png'];
const OFFLINE_PAGE = '/offline.html';
const NEVER = [/^\/api\//, /^\/client(\/|$)/, /^\/uploads\//, /^\/downloads\//, /^\/socket\.io\//, /^\/email-assets\//];

/**
 * What it never handles goes straight to the network, without waking it (static routing, Chrome 123
 * and later; other browsers ignore it). A request sent as a page goes — a notification's Remove still
 * waiting for its Undo when the page reloads — is otherwise lost with the page while it waits for
 * the worker. The same paths as NEVER.
 */
const NETWORK_PATHS = ['/api/*', '/socket.io/*', '/uploads/*', '/downloads/*', '/email-assets/*', '/client', '/client/*'];
function networkRoutes() {
  const Pattern = globalThis.URLPattern;
  if (typeof Pattern !== 'function') return null;
  return NETWORK_PATHS.map((pathname) => ({ condition: { urlPattern: new Pattern({ pathname }) }, source: 'network' }));
}

const isAsset = (path) => path.startsWith('/assets/');
const isKept = (path) => KEPT.includes(path);

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

/**
 * The page kept as the last good page, without the address it came from (a password-reset link's token
 * in /reset?token=… is never kept with it).
 */
async function pageCopy(res) {
  return new Response(await res.clone().arrayBuffer(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * The page as it is now, and the files it loads first (so a first visit can already load again offline).
 * A last good page kept already stays: a worker installing while a page of the older build is open must
 * not swap it for the new build's (the open page's code is what was kept); the next page load updates it.
 */
async function cacheShell() {
  try {
    const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    const html = await res.clone().text();
    if (!(await caches.match(SHELL_KEY))) await (await caches.open(SHELL_CACHE)).put(SHELL_KEY, await pageCopy(res));
    await cacheAssets(assetsIn(html));
  } catch {
    /* no signal while installing: kept on the next page load */
  }
}

/**
 * Before an older version's caches go (v1 → v2): its last good page and its app files come along, so
 * the rename loses nothing a page opened before it needs offline. What the current caches hold wins.
 */
async function carryOver(name) {
  let carried = 0;
  try {
    const assets = name.startsWith(`${PREFIX}assets-`);
    if (!assets && !name.startsWith(`${PREFIX}shell-`)) return 0;
    const old = await caches.open(name);
    let target = null;
    for (const request of await old.keys()) {
      const path = new URL(request.url, self.location.origin).pathname;
      if (assets ? !isAsset(path) : path !== SHELL_KEY) continue;
      target ??= await caches.open(assets ? ASSET_CACHE : SHELL_CACHE);
      if (await target.match(path)) continue;
      const res = await old.match(request);
      if (res) {
        await target.put(path, res);
        if (assets) carried += 1;
      }
    }
  } catch {
    /* an older cache that can't be read is simply removed */
  }
  return carried;
}

/** The offline page, the manifest and the icons, fetched fresh; one that can't be fetched now is skipped. */
async function cacheKept() {
  const cache = await caches.open(SHELL_CACHE);
  for (const path of KEPT) {
    try {
      const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
      if (res.ok) await cache.put(path, res);
    } catch {
      /* no signal while installing: kept on its next fetch */
    }
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
      await (await caches.open(SHELL_CACHE)).put(SHELL_KEY, await pageCopy(res));
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
    // No page was ever kept here: the plain offline page (v2), if it was.
    const offlinePage = await caches.match(OFFLINE_PAGE);
    if (offlinePage) return offlinePage;
    throw err;
  }
}

/** The manifest or an icon: the network first (kept up to date); what was kept only without signal. */
async function keptFile(request) {
  const path = new URL(request.url).pathname;
  try {
    const res = await fetch(request);
    if (res.ok) {
      try {
        await (await caches.open(SHELL_CACHE)).put(path, res.clone());
      } catch {
        /* the cache is full or refuses it: the network's answer all the same */
      }
    }
    return res;
  } catch (err) {
    const kept = await (await caches.open(SHELL_CACHE)).match(path);
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
  // Routes can only be added while installing; a browser that refuses them installs all the same.
  const routes = !KILL_SWITCH && typeof event.addRoutes === 'function' ? networkRoutes() : null;
  let routed = Promise.resolve();
  if (routes) {
    try {
      routed = Promise.resolve(event.addRoutes(routes)).catch(() => {});
    } catch {
      /* not supported here */
    }
  }
  event.waitUntil(
    (async () => {
      await routed;
      if (!KILL_SWITCH) {
        await cacheShell();
        await cacheKept();
      }
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
      let carried = 0;
      for (const name of await caches.keys()) {
        if (!name.startsWith(PREFIX) || keep.has(name)) continue;
        carried += await carryOver(name);
        await caches.delete(name);
      }
      if (carried) await trimAssets();
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
  // The offline page, the manifest and the icons — opened as a page too (the offline page is never the
  // last good page).
  if (isKept(url.pathname)) {
    event.respondWith(keptFile(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(pageLoad(request));
    return;
  }
  if (isAsset(url.pathname)) event.respondWith(appFile(request));
  // Anything else goes to the network as if there were no worker.
});
