import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth-store';
import { openAuthedSocket } from './authedSocket';

// chat:prefs (your own settings, from another tab or the phone) and project:removed (taken off a
// project) go to your own sockets only.
const CHAT_EVENTS = ['chat:message', 'chat:message:edited', 'chat:message:deleted', 'chat:reaction', 'chat:read', 'chat:delivered', 'chat:prefs', 'project:removed'] as const;

/** The live connection, as the chat page shows it. */
export type ChatConnection = 'connecting' | 'connected' | 'reconnecting' | 'offline';

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
 *
 * One connection per signed-in session: the project list usually arrives after the page (and can
 * change later), so rooms are joined and left on the live socket instead of reconnecting.
 */
export function useChatRealtime(
  projectIds: string[],
  onEvent: (event: string, payload: ChatEventPayload) => void,
  onReconnect?: () => void,
): ChatConnection {
  const [status, setStatus] = useState<ChatConnection>('connecting');
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const reconnectCb = useRef(onReconnect);
  reconnectCb.current = onReconnect;
  const key = [...projectIds].sort().join(',');
  const wanted = useRef(key);
  wanted.current = key;
  const live = useRef<Socket | null>(null);
  /** Rooms this socket has asked to join (reset on every connection: a new connection starts in none). */
  const joined = useRef<Set<string>>(new Set());
  // Re-run only when a session starts or ends — token refreshes must not tear the socket down.
  const signedIn = useAuthStore((s) => Boolean(s.accessToken));

  useEffect(() => {
    if (!signedIn) return;
    const { socket, close } = openAuthedSocket({
      onConnect: (s, isReconnect) => {
        setStatus('connected');
        joined.current = new Set(idsOf(wanted.current));
        for (const pid of joined.current) s.emit('join', { projectId: pid });
        if (isReconnect) reconnectCb.current?.();
      },
      onDisconnect: () => setStatus((cur) => (cur === 'offline' ? cur : 'reconnecting')),
    });
    // The browser knows when the network is gone; socket.io only finds out after a timeout.
    const offline = () => setStatus('offline');
    const online = () => setStatus(socket.connected ? 'connected' : 'reconnecting');
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    live.current = socket;
    for (const ev of CHAT_EVENTS) socket.on(ev, (payload: ChatEventPayload) => cb.current(ev, payload ?? {}));
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      live.current = null;
      joined.current = new Set();
      close();
    };
  }, [signedIn]);

  // The project list changed while connected: join the new rooms and leave the ones no longer shown.
  // (Before the first connection there is nothing to send — `onConnect` joins whatever is wanted then.)
  useEffect(() => {
    const socket = live.current;
    if (!socket?.connected) return;
    const next = new Set(idsOf(key));
    for (const pid of next) if (!joined.current.has(pid)) socket.emit('join', { projectId: pid });
    for (const pid of joined.current) if (!next.has(pid)) socket.emit('leave', { projectId: pid });
    joined.current = next;
  }, [key]);

  return status;
}

const idsOf = (key: string): string[] => (key ? key.split(',') : []);
