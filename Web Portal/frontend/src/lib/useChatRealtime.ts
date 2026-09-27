import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { openAuthedSocket } from './authedSocket';

const CHAT_EVENTS = ['chat:message', 'chat:message:edited', 'chat:message:deleted', 'chat:reaction', 'chat:read'] as const;

export interface ChatEventPayload {
  conversationId?: string;
  [k: string]: unknown;
}

/**
 * Subscribe to live chat events. The socket auto-joins the user's own room (for DMs) on the
 * server; here we also join each project room so channel messages arrive. `onEvent` fires with
 * the event name and payload so the page can refetch the affected conversation and the inbox.
 *
 * The socket always authenticates with the current access token and refreshes the session when a
 * reconnect is rejected as unauthorized. After a reconnect, rooms are re-joined and `onReconnect`
 * fires so the caller can refetch anything that was missed while the connection was down.
 */
export function useChatRealtime(
  projectIds: string[],
  onEvent: (event: string, payload: ChatEventPayload) => void,
  onReconnect?: () => void,
): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const reconnectCb = useRef(onReconnect);
  reconnectCb.current = onReconnect;
  const key = [...projectIds].sort().join(',');
  // Re-run only when a session starts or ends — token refreshes must not tear the socket down.
  const signedIn = useAuthStore((s) => Boolean(s.accessToken));

  useEffect(() => {
    if (!signedIn) return;
    const { socket, close } = openAuthedSocket({
      onConnect: (s, isReconnect) => {
        for (const pid of key ? key.split(',') : []) s.emit('join', { projectId: pid });
        if (isReconnect) reconnectCb.current?.();
      },
    });
    for (const ev of CHAT_EVENTS) socket.on(ev, (payload: ChatEventPayload) => cb.current(ev, payload ?? {}));
    return close;
  }, [key, signedIn]);
}
