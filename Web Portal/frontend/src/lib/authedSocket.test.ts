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
