import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openAuthedSocket } from './authedSocket';
import { useAuthStore } from '../stores/auth-store';

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
const socket = {
  connected: false,
  on: vi.fn((ev: string, cb: Handler) => { handlers[ev] = cb; }),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};
const ioMock = vi.fn((..._args: unknown[]) => socket);
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));
const socketTrouble = vi.fn();
vi.mock('./error-reporting', () => ({ noteSocketTrouble: () => socketTrouble(), noteRequest: () => {}, pageMark: () => undefined, mayRetryRequest: () => true }));

const session = (accessToken: string) =>
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken, refreshToken: 'rt' });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  socket.connected = false;
  socket.on.mockClear();
  socket.connect.mockClear();
  socket.disconnect.mockClear();
  ioMock.mockClear();
  session('token-1');
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

/** The `auth` option passed to io(): a callback that yields the handshake payload. */
function handshakeToken(): string {
  const opts = ioMock.mock.calls[ioMock.mock.calls.length - 1]![1] as { auth: (cb: (d: { token: string }) => void) => void };
  let token = '';
  opts.auth((d) => { token = d.token; });
  return token;
}

describe('openAuthedSocket', () => {
  it('reads the current access token on every handshake, not the one at mount', () => {
    openAuthedSocket();
    expect(handshakeToken()).toBe('token-1');
    session('token-2'); // e.g. refreshed by an API call
    expect(handshakeToken()).toBe('token-2');
  });

  it('refreshes the session and reconnects when the server rejects the handshake as unauthorized', async () => {
    const refresh = vi.fn(async () => { session('token-fresh'); return true; });
    openAuthedSocket({ refresh });
    handlers['connect_error']!(new Error('unauthorized'));
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(handshakeToken()).toBe('token-fresh');
  });

  it('uses the API client’s shared refresh by default', async () => {
    session('expired');
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/auth/refresh')
        ? new Response(JSON.stringify({ data: { user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'renewed', refreshToken: 'rt2' } }), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    openAuthedSocket();
    handlers['connect_error']!(new Error('unauthorized'));
    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/auth/refresh'))).toBe(true);
    expect(handshakeToken()).toBe('renewed');
  });

  it('leaves network errors to socket.io’s own reconnection', async () => {
    const refresh = vi.fn(async () => true);
    openAuthedSocket({ refresh });
    handlers['connect_error']!(new Error('xhr poll error'));
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('does not reconnect when the refresh fails', async () => {
    const refresh = vi.fn(async () => false);
    openAuthedSocket({ refresh });
    handlers['connect_error']!(new Error('unauthorized'));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('signs the user out when even a freshly refreshed token is refused (session revoked)', async () => {
    const refresh = vi.fn(async () => true);
    openAuthedSocket({ refresh });
    handlers['connect_error']!(new Error('unauthorized'));
    await flush();
    expect(socket.connect).toHaveBeenCalledTimes(1);
    handlers['connect_error']!(new Error('unauthorized')); // refused again right after the refresh
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('reconnects after the server closes the socket, but backs off when it keeps happening', () => {
    openAuthedSocket();
    for (let i = 0; i < 5; i++) handlers['disconnect']!('io server disconnect');
    expect(socket.connect).toHaveBeenCalledTimes(3);
  });

  it('does not reconnect after a client-side close or a transport drop', () => {
    const { close } = openAuthedSocket();
    handlers['disconnect']!('transport close'); // socket.io's own reconnection handles this
    close();
    handlers['disconnect']!('io server disconnect');
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('never revives a socket that was closed while a refresh was in flight', async () => {
    let resolve!: (ok: boolean) => void;
    const refresh = vi.fn(() => new Promise<boolean>((r) => { resolve = r; }));
    const { close } = openAuthedSocket({ refresh });
    handlers['connect_error']!(new Error('unauthorized'));
    close();
    resolve(true);
    await flush();
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('reports reconnects so callers can re-join rooms and refetch', () => {
    const onConnect = vi.fn();
    openAuthedSocket({ onConnect });
    handlers['connect']!();
    handlers['connect']!();
    expect(onConnect.mock.calls.map((c) => c[1])).toEqual([false, true]);
  });
});

// 1.22.4 (the Error log): a live connection that can't connect for over a minute is reported (the
// reporter keeps it to once a page load); one that connects again starts counting from scratch.
describe('a live connection that can’t connect', () => {
  it('is told to the Error log after a minute of failing, not before; a connection resets it', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    socketTrouble.mockClear();
    openAuthedSocket();
    handlers['connect_error']!(new Error('xhr poll error'));
    now += 30_000;
    handlers['connect_error']!(new Error('xhr poll error'));
    expect(socketTrouble).not.toHaveBeenCalled();
    now += 31_000;
    handlers['connect_error']!(new Error('websocket error'));
    expect(socketTrouble).toHaveBeenCalledTimes(1);
    handlers['connect']!();
    now += 5_000;
    handlers['connect_error']!(new Error('xhr poll error'));
    now += 30_000;
    handlers['connect_error']!(new Error('xhr poll error'));
    expect(socketTrouble).toHaveBeenCalledTimes(1);
    // An unauthorized handshake is not a network problem.
    now += 120_000;
    handlers['connect_error']!(new Error('unauthorized'));
    expect(socketTrouble).toHaveBeenCalledTimes(1);
  });
});

// 1.24.5 (the Error log: "waited 20–34 s before sending it (no free connection)"): every part of a page
// that listens live (the chat badge, the bell's reminders, the board, a project, a meeting…) opened its
// own connection, and on long-polling each one holds one of the browser's ~6 connections to the site.
// Now a tab has ONE live connection that all of them share.
describe('one live connection per tab', () => {
  const emits = () => socket.emit.mock.calls.filter((c) => c[0] === 'join' || c[0] === 'leave').map((c) => `${c[0]} ${(c[1] as { projectId: string }).projectId}`);
  beforeEach(() => socket.emit.mockClear());

  it('opens one connection for every listener, and closes it when the last one goes', () => {
    const a = openAuthedSocket();
    const b = openAuthedSocket();
    expect(ioMock).toHaveBeenCalledTimes(1);
    a.close();
    expect(socket.disconnect).not.toHaveBeenCalled();
    b.close();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    openAuthedSocket();
    expect(ioMock).toHaveBeenCalledTimes(2);
  });

  it('gives each listener its own events, and a closed one hears nothing more', () => {
    const a = openAuthedSocket();
    const b = openAuthedSocket();
    const ha = vi.fn();
    const hb = vi.fn();
    a.socket.on('task:created', ha);
    b.socket.on('task:created', hb);
    handlers['task:created']!({ id: 't1' });
    expect(ha).toHaveBeenCalledWith({ id: 't1' });
    expect(hb).toHaveBeenCalledWith({ id: 't1' });
    a.close();
    handlers['task:created']!({ id: 't2' });
    expect(ha).toHaveBeenCalledTimes(1);
    expect(hb).toHaveBeenCalledTimes(2);
  });

  it('tells a listener that joins an open connection it is connected (not a reconnect), and every one of a reconnect', async () => {
    const first = vi.fn();
    openAuthedSocket({ onConnect: first });
    socket.connected = true;
    handlers['connect']!();
    const later = vi.fn();
    openAuthedSocket({ onConnect: later });
    await flush();
    expect(later.mock.calls.map((c) => c[1])).toEqual([false]);
    const dropped = vi.fn();
    openAuthedSocket({ onDisconnect: dropped });
    handlers['disconnect']!('transport close');
    expect(dropped).toHaveBeenCalledWith('transport close');
    handlers['connect']!();
    expect(first.mock.calls.map((c) => c[1])).toEqual([false, true]);
    expect(later.mock.calls.map((c) => c[1])).toEqual([false, true]);
  });

  it('joins a project room once for all its listeners, and leaves it only when none needs it', () => {
    const join = (projectId: string) => ({ onConnect: (s: { emit: (e: string, p: unknown) => void }) => s.emit('join', { projectId }) });
    const a = openAuthedSocket(join('p1'));
    const b = openAuthedSocket(join('p1'));
    handlers['connect']!();
    expect(emits()).toEqual(['join p1']);
    b.socket.emit('leave', { projectId: 'p1' });
    expect(emits()).toEqual(['join p1']);
    a.socket.emit('leave', { projectId: 'p1' });
    expect(emits()).toEqual(['join p1', 'leave p1']);
    a.socket.emit('join', { projectId: 'p2' });
    b.close();
    expect(emits()).toEqual(['join p1', 'leave p1', 'join p2']);
    // After a reconnect the server has forgotten the rooms: the listeners' joins go again.
    socket.emit.mockClear();
    handlers['disconnect']!('transport close');
    handlers['connect']!();
    a.socket.emit('join', { projectId: 'p2' });
    expect(emits().sort()).toEqual(['join p1', 'join p2']);
  });

  it('a listener closed while a room is shared leaves only what no one else needs', () => {
    const a = openAuthedSocket();
    const b = openAuthedSocket();
    handlers['connect']!();
    a.socket.emit('join', { projectId: 'p1' });
    a.socket.emit('join', { projectId: 'p2' });
    b.socket.emit('join', { projectId: 'p1' });
    a.close();
    expect(emits()).toEqual(['join p1', 'join p2', 'leave p2']);
  });

  it('gives a late presence listener who is online now (the server tells it once, at connect)', async () => {
    openAuthedSocket();
    handlers['connect']!();
    handlers['presence:state']!({ userIds: ['u1', 'u2'] });
    handlers['presence:online']!({ userId: 'u3' });
    handlers['presence:offline']!({ userId: 'u1' });
    const late = openAuthedSocket();
    const seen = vi.fn();
    late.socket.on('presence:state', seen);
    await flush();
    expect(seen).toHaveBeenCalledTimes(1);
    expect([...(seen.mock.calls[0]![0] as { userIds: string[] }).userIds].sort()).toEqual(['u2', 'u3']);
  });
});

// 1.24.5 review: listeners share one connection now, so one that throws must not stop the others.
describe('a listener that throws', () => {
  it('doesn’t keep the event from the others, nor a connect from the rooms and the other listeners', () => {
    const a = openAuthedSocket({ onConnect: () => { throw new Error('boom'); } });
    const heard = vi.fn();
    const told = vi.fn();
    const b = openAuthedSocket({ onConnect: told });
    a.socket.emit('join', { projectId: 'p1' });
    a.socket.on('task:created', () => { throw new Error('boom'); });
    b.socket.on('task:created', heard);
    socket.emit.mockClear();
    handlers['connect']!();
    expect(told).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    handlers['task:created']!({ id: 't1' });
    expect(heard).toHaveBeenCalledWith({ id: 't1' });
  });
});

// 1.24.5 review (hardening): a connection is one person's; another person signed in here closes it.
describe('another person', () => {
  it('signing in closes the connection opened for the one before', () => {
    openAuthedSocket();
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'b@b.c', username: 'bea', roles: [] }, accessToken: 'token-b', refreshToken: 'rt' });
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
