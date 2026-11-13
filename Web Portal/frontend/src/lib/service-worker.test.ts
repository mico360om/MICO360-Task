import { describe, it, expect, vi } from 'vitest';
import { setUpServiceWorker } from './service-worker';

function world(over: { search?: string; pathname?: string; protocol?: string; hostname?: string; sw?: boolean; controlled?: boolean } = {}) {
  const posted: unknown[] = [];
  const unregister = vi.fn(async () => true);
  const register = vi.fn(async () => ({}));
  const changeListeners: (() => void)[] = [];
  const serviceWorker = {
    register,
    getRegistrations: vi.fn(async () => [{ unregister }]),
    ready: Promise.resolve({ active: { postMessage: (m: unknown) => void posted.push(m) } }),
    controller: over.controlled ? {} : null,
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'controllerchange') changeListeners.push(fn);
    },
  };
  const workerChanged = vi.fn();
  const deleted: string[] = [];
  const env = {
    prod: true,
    location: { search: over.search ?? '', pathname: over.pathname ?? '/inspections/i1', protocol: over.protocol ?? 'https:', hostname: over.hostname ?? 'task.mico360.com' },
    serviceWorker: over.sw === false ? undefined : serviceWorker,
    caches: { keys: async () => ['mico360-shell-v1', 'other-app'], delete: async (k: string) => void deleted.push(k) },
    loadedAssets: () => ['https://task.mico360.com/assets/index-abc.js', 'https://task.mico360.com/api/v1/me', 'https://task.mico360.com/assets/InspectionPage-x.js'],
    onWorkerChanged: workerChanged,
  };
  return { env, register, unregister, posted, deleted, workerChanged, takeOver: () => changeListeners.forEach((fn) => fn()) };
}

describe('setting up the service worker', () => {
  it('only in a production build', async () => {
    const w = world();
    expect(await setUpServiceWorker({ ...w.env, prod: false })).toBe('off');
    expect(w.register).not.toHaveBeenCalled();
  });

  it('registers /sw.js for the whole site and hands it the files this page already loaded', async () => {
    const w = world();
    expect(await setUpServiceWorker(w.env)).toBe('registered');
    expect(w.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(w.posted).toEqual([{ type: 'cache-assets', urls: ['https://task.mico360.com/assets/index-abc.js', 'https://task.mico360.com/assets/InspectionPage-x.js'] }]);
  });

  it('?nosw removes it from this browser (its caches too) and doesn’t register it', async () => {
    const w = world({ search: '?nosw' });
    expect(await setUpServiceWorker(w.env)).toBe('removed');
    expect(w.unregister).toHaveBeenCalled();
    expect(w.deleted).toEqual(['mico360-shell-v1']);
    expect(w.register).not.toHaveBeenCalled();
  });

  it('not on the client page, not without support, not on an insecure site', async () => {
    expect(await setUpServiceWorker(world({ pathname: '/client/abc' }).env)).toBe('skipped');
    // Nor on the clients' privacy notice (a client opens it from their page; it's no staff page).
    expect(await setUpServiceWorker(world({ pathname: '/privacy/client' }).env)).toBe('skipped');
    expect(await setUpServiceWorker(world({ sw: false }).env)).toBe('unsupported');
    expect(await setUpServiceWorker(world({ protocol: 'http:', hostname: 'task.example' }).env)).toBe('skipped');
    expect(await setUpServiceWorker(world({ protocol: 'http:', hostname: 'localhost' }).env)).toBe('registered');
  });

  // PWA (13 Nov): a new sw.js taking over an open page means a new version was deployed: the update
  // check looks (the notice shows only if build-info.json says the page's build is older). The first
  // worker taking over a page that had none is no update.
  it('a new service worker taking over this page asks the update check to look', async () => {
    const w = world({ controlled: true });
    await setUpServiceWorker(w.env);
    expect(w.workerChanged).not.toHaveBeenCalled();
    w.takeOver();
    expect(w.workerChanged).toHaveBeenCalledTimes(1);
    const first = world({ controlled: false });
    await setUpServiceWorker(first.env);
    first.takeOver();
    expect(first.workerChanged).not.toHaveBeenCalled();
    // Once it has one, the next new worker counts.
    first.takeOver();
    expect(first.workerChanged).toHaveBeenCalledTimes(1);
  });

  it('a registration that fails changes nothing for the page', async () => {
    const w = world();
    w.register.mockRejectedValueOnce(new Error('SecurityError'));
    expect(await setUpServiceWorker(w.env)).toBe('failed');
  });
});

// Review (13 Nov): nothing asks the browser for a new service worker mid-session (reg.update()): a worker
// installing under an open page must not happen outside the browser's own checks at page loads.
describe('the service worker is only updated at page loads', () => {
  it('no update() call in the page’s code', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const f of ['update-recovery.ts', 'service-worker.ts']) {
      expect(readFileSync(resolve(__dirname, f), 'utf8'), f).not.toMatch(/\.update\(\)/);
    }
  });
});
