import { pageUpdateWatcher } from './update-recovery';

/**
 * The service worker (public/sw.js) lets a page opened here load again without signal: an inspection
 * keeps working on a phone even if the page reloads, once it has been opened here. Production builds
 * only (Vite's dev server is left alone), never for the client page, and only on a secure site (as
 * browsers require; localhost counts).
 *
 * Way out: any page opened with ?nosw removes the worker and its caches from this browser (and
 * doesn't register it again). To switch it off for everyone, deploy sw.js with KILL_SWITCH = true.
 *
 * Installable website (13 Nov 2026): a new sw.js taking over an open page means a new version was
 * deployed, so the update check looks at once (onWorkerChanged); the notice shows only when
 * build-info.json says this page's build is older.
 */
export interface ServiceWorkerWorld {
  /** A production build. */
  prod: boolean;
  location: Pick<Location, 'search' | 'pathname' | 'protocol' | 'hostname'>;
  serviceWorker?: {
    register(url: string, options: { scope: string }): Promise<unknown>;
    getRegistrations(): Promise<ReadonlyArray<{ unregister(): Promise<boolean> }>>;
    ready: Promise<{ active: { postMessage(message: unknown): void } | null }>;
    controller?: unknown;
    addEventListener?(type: 'controllerchange', listener: () => void): void;
  };
  caches?: { keys(): Promise<string[]>; delete(name: string): Promise<unknown> };
  /** The files this page has loaded so far (resource timing). */
  loadedAssets?: () => string[];
  /** A new service worker took over this page (not the first one): a new version may be live. */
  onWorkerChanged?: () => void;
}

export type ServiceWorkerSetUp = 'off' | 'unsupported' | 'skipped' | 'removed' | 'registered' | 'failed';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export async function setUpServiceWorker(w: ServiceWorkerWorld): Promise<ServiceWorkerSetUp> {
  if (!w.prod) return 'off';
  if (!w.serviceWorker) return 'unsupported';
  if (new URLSearchParams(w.location.search).has('nosw')) {
    for (const reg of await w.serviceWorker.getRegistrations().catch(() => [])) await reg.unregister().catch(() => false);
    for (const name of (await w.caches?.keys().catch(() => [])) ?? []) if (name.startsWith('mico360-')) await w.caches!.delete(name).catch(() => false);
    return 'removed';
  }
  // Never for a client: their page, nor the privacy notice written for them (no staff page).
  if (w.location.pathname.startsWith('/client/') || w.location.pathname === '/client' || w.location.pathname.replace(/\/+$/, '') === '/privacy/client') return 'skipped';
  if (w.location.protocol !== 'https:' && !LOCAL.has(w.location.hostname)) return 'skipped';
  // The first worker taking over a page that had none is no update; every later one is.
  let hadWorker = Boolean(w.serviceWorker.controller);
  w.serviceWorker.addEventListener?.('controllerchange', () => {
    if (hadWorker) w.onWorkerChanged?.();
    hadWorker = true;
  });
  try {
    await w.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return 'failed';
  }
  // The files loaded before it took over (this first visit) are kept too, so a reload offline works.
  void w.serviceWorker.ready
    .then((reg) => {
      const urls = (w.loadedAssets?.() ?? []).filter((u) => /\/assets\//.test(new URL(u, 'https://x.invalid').pathname));
      reg.active?.postMessage({ type: 'cache-assets', urls });
    })
    .catch(() => undefined);
  return 'registered';
}

/** The browser's own world, for main.tsx. */
export function browserServiceWorkerWorld(): ServiceWorkerWorld {
  return {
    prod: import.meta.env.PROD,
    location: window.location,
    serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    caches: typeof caches !== 'undefined' ? caches : undefined,
    onWorkerChanged: () => void pageUpdateWatcher()?.check(),
    loadedAssets: () => {
      try {
        return performance.getEntriesByType('resource').map((e) => e.name);
      } catch {
        return [];
      }
    },
  };
}
