import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { CHAT_EVENTS, chatInvalidationKeys, type ChatEventPayload } from '../lib/chat-realtime';

/**
 * Live chat updates (A2.3, mirrors web M4). Connects to the socket origin with the session token;
 * the server auto-joins the user's own room (for DMs) and we join each project room so channel
 * messages arrive. Any chat event refreshes the inbox (conversation list + unread) and the affected
 * thread, so the Chat tab stays live app-wide without polling. Board realtime is separate
 * (useBoardRealtime); this pairs with it to complete the mobile realtime surface.
 */
export function useChatRealtime(projectIds: string[]): void {
  const { baseUrl, session } = useServices();
  const qc = useQueryClient();
  const key = [...projectIds].sort().join(',');

  useEffect(() => {
    const token = session.getToken();
    if (!token) return;
    const origin = baseUrl.replace(/\/api\/v1\/?$/, '');
    const socket = io(origin, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => {
      for (const pid of key ? key.split(',') : []) socket.emit('join', { projectId: pid });
    });

    const onChat = (payload: ChatEventPayload) => {
      for (const qk of chatInvalidationKeys(payload)) void qc.invalidateQueries({ queryKey: qk });
    };
    for (const ev of CHAT_EVENTS) socket.on(ev, onChat);

    return () => {
      socket.disconnect();
    };
    // session is stable for the app's lifetime; reconnect only when the joined rooms or origin change.
  }, [key, baseUrl, session, qc]);
}
