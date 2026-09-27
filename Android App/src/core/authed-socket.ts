import { io, type Socket } from 'socket.io-client';
import { createSocketAuthHandler, currentTokenAuth } from '../lib/socket-auth';
import type { Services } from './services';

/**
 * Open a socket.io connection that stays authenticated (XP-05):
 * - the handshake reads the CURRENT access token on every (re)connect attempt (not the one
 *   captured when the screen mounted);
 * - an `unauthorized` rejection, or the server closing the socket (expired token / revoked
 *   session), refreshes the session through the app's single-flight refresh and reconnects;
 * - `onConnect(socket, isReconnect)` runs on every connect so callers can (re)join rooms and, on a
 *   reconnect, refetch whatever changed while the socket was down.
 */
export function connectAuthedSocket(
  services: Pick<Services, 'baseUrl' | 'session' | 'api' | 'signOut' | 'sync'>,
  onConnect: (socket: Socket, isReconnect: boolean) => void,
): { socket: Socket; dispose: () => void } {
  const origin = services.baseUrl.replace(/\/api\/v1\/?$/, '');
  const socket = io(origin, {
    auth: currentTokenAuth(() => services.session.getToken()),
    transports: ['websocket'],
  });

  const auth = createSocketAuthHandler({
    refresh: () => services.api.refreshSession(),
    reconnect: () => {
      if (!socket.connected) socket.connect();
    },
    onSessionEnded: () => {
      void services.signOut('expired');
    },
  });

  socket.on('connect', () => {
    const isReconnect = auth.onConnect();
    onConnect(socket, isReconnect);
    // Being connected again is a good moment to replay queued offline changes.
    if (isReconnect) void services.sync.trigger();
  });
  socket.on('connect_error', (err: Error) => {
    void auth.onConnectError(err, socket.active);
  });
  // The server closes the socket when the access token expires or the session is revoked;
  // socket.io does not reconnect after a server-side close, so refresh and reconnect ourselves.
  socket.on('disconnect', (reason: string) => {
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
