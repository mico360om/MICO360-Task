import { describe, it, expect, vi } from 'vitest';
import { createUpdateWatcher, installPreloadRecovery, isChunkFailure, markPageGoing, RELOAD_KEY, recoverChunk, recoverFromChunkFailure, type RecoveryWorld } from './update-recovery';

const RUNNING = { version: '1.23.0', builtAt: '2026-11-05T18:00:00.000Z' };
const NEWER = { version: '1.23.1', builtAt: '2026-11-05T22:20:00.000Z' };

function world(over: Partial<RecoveryWorld> = {}) {
  const store = new Map<string, string>();
  const w: RecoveryWorld & { store: Map<string, string>; reloads: number } = {
    running: RUNNING,
    deployed: async () => NEWER,
    online: () => true,
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    reload: () => {
      w.reloads += 1;
    },
    memory: new Set(),
    store,
    reloads: 0,
    ...over,
  };
  return w;
}

describe('after the site’s code fails to load (a deploy replaced it)', () => {
  it('a newer version is deployed: reload once, to it', async () => {
    const w = world();
    expect(await recoverFromChunkFailure(w)).toBe('reloading');
    expect(w.reloads).toBe(1);
    expect(w.store.get(RELOAD_KEY)).toBe(`${NEWER.version}|${NEWER.builtAt}`);
  });

  it('never twice for the same version: the next failure shows the message instead (no loop)', async () => {
    const w = world();
    await recoverFromChunkFailure(w);
    expect(await recoverFromChunkFailure(w)).toBe('failed');
    expect(w.reloads).toBe(1);
  });

  it('the same version is deployed (a file really is missing): no reload, the message', async () => {
    const w = world({ deployed: async () => RUNNING });
    expect(await recoverFromChunkFailure(w)).toBe('failed');
    expect(w.reloads).toBe(0);
  });

  it('offline, or the version can’t be read: no reload, the message', async () => {
    expect(await recoverFromChunkFailure(world({ online: () => false }))).toBe('failed');
    const unreadable = world({ deployed: async () => null });
    expect(await recoverFromChunkFailure(unreadable)).toBe('failed');
    expect(unreadable.reloads).toBe(0);
  });

  it('storage that throws (a private window) still reloads at most once in this page', async () => {
    const w = world({ storage: { get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); } } });
    expect(await recoverFromChunkFailure(w)).toBe('reloading');
    expect(w.reloads).toBe(1);
  });

  it('knows a code-loading failure when it sees one', () => {
    expect(isChunkFailure(new TypeError('Failed to fetch dynamically imported module: https://task.mico360.com/assets/ManagementPage-SAS2EKa4.js'))).toBe(true);
    expect(isChunkFailure(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true);
    expect(isChunkFailure(new Error('x is undefined'))).toBe(false);
  });
});

describe('noticing a newer version before anything fails', () => {
  function watcher(over: { deployed?: () => Promise<typeof NEWER | null>; typing?: boolean } = {}) {
    let focus: () => void = () => {};
    let visible: () => void = () => {};
    let tick: () => void = () => {};
    const assigned: string[] = [];
    const store = new Map<string, string>();
    const w = createUpdateWatcher({
      running: RUNNING,
      deployed: over.deployed ?? (async () => NEWER),
      onFocus: (cb) => ((focus = cb), () => {}),
      onVisible: (cb) => ((visible = cb), () => {}),
      every: (ms, cb) => {
        expect(ms).toBe(10 * 60_000);
        tick = cb;
        return () => {};
      },
      typing: () => over.typing ?? false,
      assign: (url) => void assigned.push(url),
      storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
      memory: new Set(),
    });
    w.start();
    return { w, focus: () => focus(), visible: () => visible(), tick: () => tick(), assigned };
  }

  // PWA (13 Nov): an installed app has no reload button and is mostly brought back, not focused: coming
  // back to it checks too. (The service worker itself is checked by the browser at page loads only.)
  it('coming back to the app checks too', async () => {
    let deployed = RUNNING;
    const { w, visible } = watcher({ deployed: async () => deployed });
    await new Promise((r) => setTimeout(r, 0));
    expect(w.stale).toBe(false);
    deployed = NEWER;
    visible();
    await vi.waitFor(() => expect(w.stale).toBe(true));
  });

  it('tells whoever listens (the update notice) once per newer version', async () => {
    let deployed: typeof NEWER = RUNNING;
    const { w, focus, tick } = watcher({ deployed: async () => deployed });
    const heard = vi.fn();
    const stop = w.subscribe(heard);
    focus();
    await new Promise((r) => setTimeout(r, 0));
    expect(heard).not.toHaveBeenCalled();
    expect(w.newer).toBeNull();
    deployed = NEWER;
    tick();
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    expect(w.newer).toEqual(NEWER);
    focus();
    await new Promise((r) => setTimeout(r, 0));
    expect(heard).toHaveBeenCalledTimes(1);
    // An even newer one: told again.
    deployed = { version: '1.23.2', builtAt: '2026-11-06T08:00:00.000Z' };
    await w.check();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    deployed = { version: '1.23.3', builtAt: '2026-11-07T08:00:00.000Z' };
    await w.check();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  // As the footer's banner did before it: a page opened from an older copy (the browser's cache, the
  // worker's last good page) says so at once, without waiting for focus or the interval.
  it('looks once when it starts', async () => {
    const { w } = watcher();
    await vi.waitFor(() => expect(w.stale).toBe(true));
  });

  it('a check that fails (no signal) changes nothing and asks again next time', async () => {
    let fail = true;
    const { w, focus } = watcher({ deployed: async () => (fail ? Promise.reject(new TypeError('offline')) : NEWER) });
    focus();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.stale).toBe(false);
    fail = false;
    focus();
    await vi.waitFor(() => expect(w.stale).toBe(true));
  });

  it('checks on focus and every 10 minutes; the next move to another page is a full page load there', async () => {
    const { w, focus, assigned } = watcher();
    expect(w.navigate('/board')).toBe(false); // nothing known yet
    focus();
    await vi.waitFor(() => expect(w.stale).toBe(true));
    expect(w.navigate('/management?x=1')).toBe(true);
    expect(assigned).toEqual(['/management?x=1']);
    // Once per version: a page that still looks old (a cache) never reloads at every move.
    expect(w.navigate('/board')).toBe(false);
  });

  it('the interval finds it too; the same version is nothing to do', async () => {
    const same = watcher({ deployed: async () => RUNNING });
    same.tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(same.w.stale).toBe(false);
    const newer = watcher();
    newer.tick();
    await vi.waitFor(() => expect(newer.w.stale).toBe(true));
  });

  it('never while someone is typing', async () => {
    const { w, focus, assigned } = watcher({ typing: true });
    focus();
    await vi.waitFor(() => expect(w.stale).toBe(true));
    expect(w.navigate('/board')).toBe(false);
    expect(assigned).toEqual([]);
  });
});

// Vite answers a page's import with `undefined` when its vite:preloadError event is cancelled, so the
// lazy page would fail with "Cannot read properties of undefined" — an error that is recorded and is
// not a code-loading failure. The listener only starts the recovery; the failure goes on to its loader.
describe('Vite’s preload failure event', () => {
  it('starts the recovery and leaves the failure to its loader (never cancelled)', () => {
    const target = new EventTarget() as unknown as Window;
    const recover = vi.fn(async () => 'failed' as const);
    installPreloadRecovery(target, recover);
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: new TypeError('Failed to fetch dynamically imported module: /assets/ManagementPage-SAS2EKa4.js') });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(recover).toHaveBeenCalledTimes(1);
  });
});

// Once the page is on its way to the new build (a reload, or the full page load of the next move), a
// page's code failing meanwhile is part of leaving: never the error page, never recorded.
describe('a page already loading the new build', () => {
  it('answers “reloading” to every later failure, without asking the server again', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    markPageGoing();
    expect(await recoverChunk()).toBe('reloading');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
