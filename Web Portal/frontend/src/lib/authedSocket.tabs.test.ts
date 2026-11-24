import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1.24.5 (the Error log: "waited 20–34 s before sending it (no free connection)"): with the site open in
// several tabs, each tab's live connection held one of the browser's ~6 connections to the site on
// long-polling. Now the tabs share one: the tab holding a Web Lock keeps the socket, the others hear its
// events over a BroadcastChannel and tell it which project rooms they need.

type Handler = (...a: unknown[]) => void;
interface FakeSocket {
  h: Record<string, Handler>;
  any: Handler | null;
  mgr: Record<string, Handler>;
  connected: boolean;
  on: (ev: string, cb: Handler) => void;
  onAny: (cb: Handler) => void;
  emit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  io: { on: (ev: string, cb: Handler) => void };
  up: () => void;
  fire: (ev: string, ...args: unknown[]) => void;
}
const sockets: FakeSocket[] = [];
function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    h: {},
    any: null,
    mgr: {},
    connected: false,
    on: (ev, cb) => {
      s.h[ev] = cb;
    },
    onAny: (cb) => {
      s.any = cb;
    },
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(() => {
      s.connected = false;
    }),
    io: {
      on: (ev, cb) => {
        s.mgr[ev] = cb;
      },
    },
    up: () => {
      s.connected = true;
      s.h['connect']!();
    },
    fire: (ev, ...args) => s.any?.(ev, ...args),
  };
  sockets.push(s);
  return s;
}
vi.mock('socket.io-client', () => ({ io: () => fakeSocket() }));

/** Web Locks as the browser keeps them: one holder, a queue, `signal` to stop waiting, `steal` to take over. */
interface Waiter {
  cb: () => Promise<void>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}
function fakeLocks() {
  const state = new Map<string, { holder: Waiter | null; queue: Waiter[] }>();
  const of = (name: string) => state.get(name) ?? (state.set(name, { holder: null, queue: [] }), state.get(name)!);
  const grant = (name: string) => {
    const s = of(name);
    if (s.holder || s.queue.length === 0) return;
    const w = s.queue.shift()!;
    s.holder = w;
    void Promise.resolve()
      .then(() => w.cb())
      .then(
        (v) => {
          if (s.holder !== w) return;
          s.holder = null;
          w.resolve(v);
          grant(name);
        },
        (e) => {
          if (s.holder !== w) return;
          s.holder = null;
          w.reject(e);
          grant(name);
        },
      );
  };
  return {
    held: (name: string) => of(name).holder !== null,
    request(name: string, opts: { signal?: AbortSignal; steal?: boolean }, cb: () => Promise<void>) {
      return new Promise((resolve, reject) => {
        const s = of(name);
        const w: Waiter = { cb, resolve, reject };
        if (opts.steal) {
          s.holder?.reject(new DOMException('stolen', 'AbortError'));
          s.holder = null;
          s.queue.unshift(w);
          grant(name);
          return;
        }
        opts.signal?.addEventListener('abort', () => {
          const i = s.queue.indexOf(w);
          if (i >= 0) {
            s.queue.splice(i, 1);
            reject(new DOMException('aborted', 'AbortError'));
          }
        });
        s.queue.push(w);
        grant(name);
      });
    },
  };
}

type Tab = typeof import('./authedSocket');
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const tab = await import('./authedSocket');
  const { useAuthStore } = await import('../stores/auth-store');
  useAuthStore.setState({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt', isAuthenticated: true });
  return tab;
}

let locks: ReturnType<typeof fakeLocks>;
const tabs: Tab[] = [];
beforeEach(() => {
  sockets.length = 0;
  locks = fakeLocks();
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
});
afterEach(() => {
  for (const t of tabs.splice(0)) t.resetLiveConnectionForTests();
  delete (navigator as unknown as { locks?: unknown }).locks;
  vi.useRealTimers();
});
async function twoTabs(): Promise<[Tab, Tab]> {
  const a = await openTab();
  const b = await openTab();
  tabs.push(a, b);
  return [a, b];
}

describe('one live connection for all tabs', () => {
  it('the first tab holds the socket; another tab hears its events and its connects', async () => {
    const [a, b] = await twoTabs();
    a.openAuthedSocket();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const onConnect = vi.fn();
    const heard = vi.fn();
    const inB = b.openAuthedSocket({ onConnect });
    inB.socket.on('task:created', heard);
    sockets[0]!.up();
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledWith(inB.socket, false));
    sockets[0]!.fire('task:created', { id: 't1' });
    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith({ id: 't1' }));
    expect(inB.socket.connected).toBe(true);
    // Still one socket for both tabs.
    expect(sockets).toHaveLength(1);
  });

  it('joins a room another tab needs, once, and leaves it when no tab needs it', async () => {
    const [a, b] = await twoTabs();
    const inA = a.openAuthedSocket();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const s = sockets[0]!;
    s.up();
    const rooms = () => s.emit.mock.calls.map((c) => `${c[0]} ${(c[1] as { projectId: string }).projectId}`);
    const inB = b.openAuthedSocket();
    inB.socket.emit('join', { projectId: 'p1' });
    await vi.waitFor(() => expect(rooms()).toEqual(['join p1']));
    inA.socket.emit('join', { projectId: 'p1' });
    inB.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(rooms()).toEqual(['join p1']);
    inA.socket.emit('leave', { projectId: 'p1' });
    expect(rooms()).toEqual(['join p1', 'leave p1']);
  });

  it('when the holding tab lets go, another tab takes the socket over and its listeners hear a reconnect', async () => {
    const [a, b] = await twoTabs();
    const inA = a.openAuthedSocket();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.up();
    const onConnect = vi.fn();
    const inB = b.openAuthedSocket({ onConnect });
    inB.socket.emit('join', { projectId: 'p1' });
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    inA.close();
    expect(sockets[0]!.disconnect).toHaveBeenCalled();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.up();
    expect(onConnect.mock.calls.map((c) => c[1])).toEqual([false, true]);
    expect(sockets[1]!.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
  });

  it('a visible tab takes over from a holding tab that has gone silent (a frozen tab), which then steps down', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const [a, b] = await twoTabs();
    a.openAuthedSocket();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.up();
    const onConnect = vi.fn();
    b.openAuthedSocket({ onConnect });
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    // The server's pings keep it the holder…
    vi.advanceTimersByTime(60_000);
    sockets[0]!.mgr['ping']!();
    await new Promise((r) => setTimeout(r, 30));
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    // …silence for longer than LEADER_SILENT_MS does not.
    vi.advanceTimersByTime(b.LEADER_SILENT_MS);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    await vi.waitFor(() => expect(sockets[0]!.disconnect).toHaveBeenCalled());
    sockets[1]!.up();
    expect(onConnect.mock.calls.map((c) => c[1])).toEqual([false, true]);
  });

  it('another tab hears that the person’s companies changed (it refreshes what it shows)', async () => {
    const [a, b] = await twoTabs();
    a.openAuthedSocket();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.up();
    const onConnect = vi.fn();
    b.openAuthedSocket({ onConnect });
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    const changedInB = vi.fn();
    b.onCompaniesChanged(changedInB);
    sockets[0]!.fire('companies:changed');
    await vi.waitFor(() => expect(changedInB).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it('a listener that throws in the holding tab doesn’t keep the event from the other tabs', async () => {
    const [a, b] = await twoTabs();
    a.openAuthedSocket().socket.on('task:created', () => {
      throw new Error('boom');
    });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.up();
    const heard = vi.fn();
    b.openAuthedSocket().socket.on('task:created', heard);
    await new Promise((r) => setTimeout(r, 30));
    sockets[0]!.fire('task:created', { id: 't1' });
    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith({ id: 't1' }));
  });

  it('hears only the tab it follows (never a second holder’s copies)', async () => {
    const [a, b] = await twoTabs();
    a.openAuthedSocket();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.up();
    const heard = vi.fn();
    const onConnect = vi.fn();
    b.openAuthedSocket({ onConnect }).socket.on('task:created', heard);
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    const intruder = new BroadcastChannel('mico360-live:u1');
    intruder.postMessage({ t: 'ev', from: 'someone-else', ev: 'task:created', args: [{ id: 'x' }] });
    intruder.postMessage({ t: 'state', from: 'someone-else', connected: true, conn: 'other:1', presence: null });
    await new Promise((r) => setTimeout(r, 50));
    intruder.close();
    expect(heard).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('a holding tab whose lock was taken steps down', async () => {
    const [a] = await twoTabs();
    a.openAuthedSocket();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.up();
    void locks.request('mico360-live:u1', { steal: true }, () => new Promise<void>(() => {})).catch(() => {}); // a later steal rejects it, as a browser would
    await vi.waitFor(() => expect(sockets[0]!.disconnect).toHaveBeenCalled());
  });

  it('a tab that is shown and gets no answer from a holder within seconds takes over', async () => {
    // Someone holds the lock but never answers (a frozen tab).
    void locks.request('mico360-live:u1', {}, () => new Promise<void>(() => {})).catch(() => {});
    const [, b] = await twoTabs();
    b.openAuthedSocket();
    await new Promise((r) => setTimeout(r, 30));
    expect(sockets).toHaveLength(0);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(sockets).toHaveLength(1), { timeout: 6000 });
  });

  it('a tab that goes away gives up its rooms; the holding tab coming back from the back/forward cache says it is connected', async () => {
    const [a, b] = await twoTabs();
    a.openAuthedSocket();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const s = sockets[0]!;
    s.up();
    const onConnect = vi.fn();
    const inB = b.openAuthedSocket({ onConnect });
    inB.socket.emit('join', { projectId: 'p1' });
    await vi.waitFor(() => expect(s.emit).toHaveBeenCalledWith('join', { projectId: 'p1' }));
    // (Both stand-in tabs share one window: pagehide is each tab's.)
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    await vi.waitFor(() => expect(s.emit).toHaveBeenCalledWith('leave', { projectId: 'p1' }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await vi.waitFor(() => expect(onConnect.mock.calls.map((c) => c[1])).toEqual([false, true]));
    await vi.waitFor(() => expect(s.emit.mock.calls.filter((c) => c[0] === 'join')).toHaveLength(2));
  });

  it('keeps its own connection where the browser has no Web Locks', async () => {
    delete (navigator as unknown as { locks?: unknown }).locks;
    const [a, b] = await twoTabs();
    a.openAuthedSocket();
    b.openAuthedSocket();
    expect(sockets).toHaveLength(2);
  });
});
