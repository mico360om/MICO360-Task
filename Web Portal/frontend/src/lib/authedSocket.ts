import { io, type Socket } from 'socket.io-client';
import { refreshSession } from '../api/client';
import { useAuthStore } from '../stores/auth-store';

/** Socket origin (the API origin, without the /api/v1 prefix). */
export const SOCKET_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

/** How many refresh-and-retry rounds an unauthorized handshake gets before we give up. */
const MAX_AUTH_RETRIES = 3;
/** A handshake rejected this soon after a successful refresh means the session itself was revoked. */
const REVOKED_WITHIN_MS = 30_000;
/** Server-initiated disconnects (token expiry / revocation) reconnected per minute before backing off. */
const MAX_SERVER_RECONNECTS_PER_MIN = 3;

export interface AuthedSocketOptions {
  /**
   * Runs after every successful connection. `isReconnect` is true from the second connection on,
   * which is when callers should re-join rooms and refetch whatever they may have missed.
   */
  onConnect?: (socket: Socket, isReconnect: boolean) => void;
  /**
   * How to get a fresh access token after the server rejects the handshake. Defaults to the API
   * client's shared, cross-tab-safe `refreshSession` (so a socket never races the API client for
   * the single-use refresh token).
   */
  refresh?: () => Promise<boolean>;
}

export interface AuthedSocket {
  socket: Socket;
  /** Disconnect for good — a refresh still in flight will not reconnect it. */
  close: () => void;
}

/**
 * Open a socket.io connection that always authenticates with the *current* access token.
 *
 * - `auth` is a callback, so every (re)connect handshake reads the token from the auth store
 *   instead of the one captured when the component mounted.
 * - When the server rejects the handshake as unauthorized (e.g. the 15-minute access token expired
 *   while the laptop slept), socket.io stops retrying on its own; we refresh the session and
 *   reconnect. If even a freshly refreshed token is refused, the session was revoked and the user
 *   is signed out.
 * - The server also closes live sockets whose token expired or whose session was revoked, and
 *   socket.io never reconnects after a server-side close; we reconnect (rate limited), and the
 *   handshake above sorts out whether the session is still valid.
 * - Transport errors are left to socket.io's own reconnection.
 */
export function openAuthedSocket(opts: AuthedSocketOptions = {}): AuthedSocket {
  const refresh = opts.refresh ?? refreshSession;
  const socket = io(SOCKET_URL, {
    auth: (cb: (data: object) => void) => cb({ token: useAuthStore.getState().accessToken ?? '' }),
  });

  let closed = false;
  let connectedBefore = false;
  let authRetries = 0;
  let refreshing = false;
  let lastRefreshAt = 0;
  let serverDisconnects: number[] = [];

  socket.on('connect', () => {
    authRetries = 0;
    const isReconnect = connectedBefore;
    connectedBefore = true;
    opts.onConnect?.(socket, isReconnect);
  });

  socket.on('connect_error', (err: Error) => {
    if (!/unauthori[sz]ed/i.test(err?.message ?? '')) return; // network trouble: socket.io retries itself
    if (closed || refreshing) return;
    if (lastRefreshAt && Date.now() - lastRefreshAt < REVOKED_WITHIN_MS) {
      closed = true;
      socket.disconnect();
      useAuthStore.getState().logout('expired');
      return;
    }
    if (authRetries >= MAX_AUTH_RETRIES) return;
    authRetries += 1;
    refreshing = true;
    void refresh()
      .then((ok) => {
        if (!ok) return;
        lastRefreshAt = Date.now();
        if (!closed && !socket.connected) socket.connect();
      })
      .catch(() => {})
      .finally(() => {
        refreshing = false;
      });
  });

  socket.on('disconnect', (reason: string) => {
    if (reason !== 'io server disconnect' || closed) return;
    const now = Date.now();
    serverDisconnects = serverDisconnects.filter((t) => now - t < 60_000);
    if (serverDisconnects.length >= MAX_SERVER_RECONNECTS_PER_MIN) return;
    serverDisconnects.push(now);
    socket.connect();
  });

  return {
    socket,
    close: () => {
      closed = true;
      socket.disconnect();
    },
  };
}
