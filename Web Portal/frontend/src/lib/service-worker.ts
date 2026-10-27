/**
 * The service worker (public/sw.js) lets a page opened here load again without signal: an inspection
 * keeps working on a phone even if the page reloads, once it has been opened here. Production builds
 * only (Vite's dev server is left alone), never for the client page, and only on a secure site (as
 * browsers require; localhost counts).
 *
 * Way out: any page opened with ?nosw removes the worker and its caches from this browser (and
 * doesn't register it again). To switch it off for everyone, deploy sw.js with KILL_SWITCH = true.
 */
export interface ServiceWorkerWorld {
  /** A production build. */
  prod: boolean;
  location: Pick<Location, 'search' | 'pathname' | 'protocol' | 'hostname'>;
  serviceWorker?: {
    register(url: string, options: { scope: string }): Promise<unknown>;
    getRegistrations(): Promise<ReadonlyArray<{ unregister(): Promise<boolean> }>>;
    ready: Promise<{ active: { postMessage(message: unknown): void } | null }>;
  };
  caches?: { keys(): Promise<string[]>; delete(name: string): Promise<unknown> };
  /** The files this page has loaded so far (resource timing). */
  loadedAssets?: () => string[];
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
  if (w.location.pathname.startsWith('/client/') || w.location.pathname === '/client') return 'skipped';
  if (w.location.protocol !== 'https:' && !LOCAL.has(w.location.hostname)) return 'skipped';
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
    loadedAssets: () => {
      try {
        return performance.getEntriesByType('resource').map((e) => e.name);
      } catch {
        return [];
      }
    },
  };
}
