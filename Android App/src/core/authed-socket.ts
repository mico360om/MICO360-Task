import { io, type Socket } from 'socket.io-client';
import { createSocketAuthHandler, currentTokenAuth } from '../lib/socket-auth';
import { isAllowedUrl } from '../lib/server-address';
import { isConnectionDrop, serverReached } from '../lib/connectivity';
import type { Services } from './services';

/**
 * Open a socket.io connection that stays authenticated (XP-05):
 * - the handshake reads the CURRENT access token on every (re)connect attempt (not the one
 *   captured when the screen mounted);
 * - an `unauthorized` rejection, or the server closing the socket (expired token / revoked
 *   session), refreshes the session through the app's single-flight refresh and reconnects;
 * - `onConnect(socket, isReconnect)` runs on every connect so callers can (re)join rooms and, on a
 *   reconnect, refetch whatever changed while the socket was down;
 * - connecting tells the app the server can be reached, and a live connection dropping tells it
 *   the server can't (connectivity), so screens refresh once it is back.
 */
export function connectAuthedSocket(
  services: Pick<Services, 'baseUrl' | 'session' | 'api' | 'signOut' | 'sync' | 'connectivity'>,
  onConnect: (socket: Socket, isReconnect: boolean) => void,
): { socket: Socket; dispose: () => void } {
  const origin = services.baseUrl.replace(/\/api\/v1\/?$/, '');
  const socket = io(origin, {
    auth: currentTokenAuth(() => services.session.getToken()),
    transports: ['websocket'],
    // The handshake carries the access token: never connect over plain http to the internet.
    autoConnect: isAllowedUrl(origin),
  });

  // This connection is the person's who opened it: it is renewed only for them (5b review) — once
  // someone else is signed in the refresh answers 'changed' and the socket stops.
  const owner = services.session.getSession()?.user.id ?? null;
  const auth = createSocketAuthHandler({
    refresh: () => services.api.refreshSession(owner),
    reconnect: () => {
      if (!socket.connected && isAllowedUrl(origin)) socket.connect();
    },
    onSessionEnded: () => {
      void services.signOut('expired');
    },
  });

  socket.on('connect', () => {
    const isReconnect = auth.onConnect();
    // Being connected again is a good moment to replay queued offline changes.
    serverReached(services.connectivity, () => {
      if (isReconnect) void services.sync.trigger();
    });
    onConnect(socket, isReconnect);
  });
  socket.on('connect_error', (err: Error) => {
    void auth.onConnectError(err, socket.active);
  });
  // The server closes the socket when the access token expires or the session is revoked;
  // socket.io does not reconnect after a server-side close, so refresh and reconnect ourselves.
  socket.on('disconnect', (reason: string) => {
    if (isConnectionDrop(reason)) services.connectivity.unreachable();
    void auth.onDisconnect(reason);
  });

  return {
    socket,
    dispose: () => {
      auth.stop();
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
