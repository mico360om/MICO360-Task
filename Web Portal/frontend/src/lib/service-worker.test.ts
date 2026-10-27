import { describe, it, expect, vi } from 'vitest';
import { setUpServiceWorker } from './service-worker';

function world(over: { search?: string; pathname?: string; protocol?: string; hostname?: string; sw?: boolean } = {}) {
  const posted: unknown[] = [];
  const unregister = vi.fn(async () => true);
  const register = vi.fn(async () => ({}));
  const serviceWorker = {
    register,
    getRegistrations: vi.fn(async () => [{ unregister }]),
    ready: Promise.resolve({ active: { postMessage: (m: unknown) => void posted.push(m) } }),
  };
  const deleted: string[] = [];
  const env = {
    prod: true,
    location: { search: over.search ?? '', pathname: over.pathname ?? '/inspections/i1', protocol: over.protocol ?? 'https:', hostname: over.hostname ?? 'task.mico360.com' },
    serviceWorker: over.sw === false ? undefined : serviceWorker,
    caches: { keys: async () => ['mico360-shell-v1', 'other-app'], delete: async (k: string) => void deleted.push(k) },
    loadedAssets: () => ['https://task.mico360.com/assets/index-abc.js', 'https://task.mico360.com/api/v1/me', 'https://task.mico360.com/assets/InspectionPage-x.js'],
  };
  return { env, register, unregister, posted, deleted };
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
    expect(await setUpServiceWorker(world({ sw: false }).env)).toBe('unsupported');
    expect(await setUpServiceWorker(world({ protocol: 'http:', hostname: 'task.example' }).env)).toBe('skipped');
    expect(await setUpServiceWorker(world({ protocol: 'http:', hostname: 'localhost' }).env)).toBe('registered');
  });

  it('a registration that fails changes nothing for the page', async () => {
    const w = world();
    w.register.mockRejectedValueOnce(new Error('SecurityError'));
    expect(await setUpServiceWorker(w.env)).toBe('failed');
  });
});
