import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../stores/auth-store';

/** Socket origin (without the /api/v1 prefix). */
const SOCKET_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');
const CHAT_EVENTS = ['chat:message', 'chat:message:edited', 'chat:message:deleted', 'chat:reaction', 'chat:read'] as const;

export interface ChatEventPayload {
  conversationId?: string;
  [k: string]: unknown;
}

/**
 * Subscribe to live chat events. The socket auto-joins the user's own room (for DMs) on the
 * server; here we also join each project room so channel messages arrive. `onEvent` fires with
 * the event name and payload so the page can refetch the affected conversation and the inbox.
 */
export function useChatRealtime(projectIds: string[], onEvent: (event: string, payload: ChatEventPayload) => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const key = [...projectIds].sort().join(',');

  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    const socket = io(SOCKET_URL, { auth: { token } });
    socket.on('connect', () => {
      for (const pid of key ? key.split(',') : []) socket.emit('join', { projectId: pid });
    });
    for (const ev of CHAT_EVENTS) socket.on(ev, (payload: ChatEventPayload) => cb.current(ev, payload ?? {}));
    return () => {
      socket.disconnect();
    };
  }, [key]);
}
