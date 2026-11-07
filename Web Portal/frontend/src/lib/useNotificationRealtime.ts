import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { openAuthedSocket } from './authedSocket';

/**
 * Be told of each new notification the moment the server stores it (`notification:new`, sent to
 * your own sockets only). After a dropped connection comes back, `onReconnect` fires so the bell
 * can be read again. One connection per signed-in session.
 */
export function useNotificationRealtime(onNotification: (payload: unknown) => void, onReconnect?: () => void, enabled = true): void {
  const cb = useRef(onNotification);
  cb.current = onNotification;
  const reconnectCb = useRef(onReconnect);
  reconnectCb.current = onReconnect;
  // Re-run only when a session starts or ends — token refreshes must not tear the socket down.
  const signedIn = useAuthStore((s) => Boolean(s.accessToken));

  useEffect(() => {
    // 1.23.5: off for a list whose page already listens (a project's Next actions).
    if (!signedIn || !enabled) return;
    const { socket, close } = openAuthedSocket({
      onConnect: (_s, isReconnect) => {
        if (isReconnect) reconnectCb.current?.();
      },
    });
    socket.on('notification:new', (payload: unknown) => cb.current(payload));
    return close;
  }, [signedIn, enabled]);
}
