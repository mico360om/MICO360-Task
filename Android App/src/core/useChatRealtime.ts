import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { connectAuthedSocket } from './authed-socket';
import { CHAT_EVENTS, chatInvalidationKeys, type ChatEventPayload } from '../lib/chat-realtime';
import { PROJECT_REMOVED_EVENT } from '../lib/realtime';

/**
 * Live chat updates (A2.3, mirrors web M4, XP-05). The server auto-joins the user's own room (for
 * DMs) and we join each project room so channel messages arrive. Any chat event refreshes the
 * inbox (conversation list + unread) and the affected thread. The socket re-authenticates with a
 * fresh token after expiry, and after a reconnect all chat data is refetched so messages sent
 * while disconnected appear.
 */
export function useChatRealtime(projectIds: string[]): void {
  const services = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  const key = [...projectIds].sort().join(',');

  useEffect(() => {
    if (!userId) return;
    const { socket, dispose } = connectAuthedSocket(services, (s, isReconnect) => {
      for (const pid of key ? key.split(',') : []) s.emit('join', { projectId: pid });
      if (isReconnect) void qc.invalidateQueries({ queryKey: ['chat'] });
    });

    const onChat = (payload: ChatEventPayload) => {
      for (const qk of chatInvalidationKeys(payload)) void qc.invalidateQueries({ queryKey: qk });
    };
    for (const ev of CHAT_EVENTS) socket.on(ev, onChat);
    // Removed from a project: its channel and data are gone — refresh projects, chats and tasks.
    // (The new project list changes the joined rooms, which reconnects this socket.)
    socket.on(PROJECT_REMOVED_EVENT, () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['chat'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'] });
    });

    return dispose;
    // Reconnect only when the joined rooms, the signed-in user or the services change.
  }, [key, userId, services, qc]);
}
