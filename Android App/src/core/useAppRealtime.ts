import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { connectAuthedSocket } from './authed-socket';
import { CHAT_EVENTS, chatInvalidationKeys, type ChatEventPayload } from '../lib/chat-realtime';
import { MEETING_EVENTS, meetingEventRefreshes, meetingsReconnectRefreshes } from '../lib/meeting-realtime';
import { PROJECT_REMOVED_EVENT } from '../lib/realtime';
import { refresh } from '../lib/refresh';
import { createRefreshBatcher } from '../lib/refresh-batch';

/**
 * The app's one signed-in socket for live chat and meeting updates (A2.3, XP-05; meetings since
 * 2a). The server auto-joins the user's own room (direct messages, and every meeting they organize,
 * created or are invited to) and we join each project room (channel messages and the project's
 * meetings). One socket for both, so taking part in meetings costs no extra connection.
 *
 * - A chat event refreshes the inbox (conversation list + unread) and the affected thread.
 * - A meeting event refreshes the part of that meeting it names, and the lists showing it
 *   (meeting-realtime) — only what is on screen is fetched again.
 *
 * Each kind has its own batcher: the first event shows at once and the ones within about 300 ms
 * after it are gathered into one pass (a burst of messages, notes or answers doesn't fetch once per
 * event). The socket re-authenticates with a fresh token after expiry, and after a reconnect all
 * chat and meeting data is refetched, since events may have been missed.
 */
export function useAppRealtime(projectIds: string[]): void {
  const services = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  const key = [...projectIds].sort().join(',');

  useEffect(() => {
    if (!userId) return;
    const chat = createRefreshBatcher((targets) => refresh(qc, targets), { leading: true });
    const meetings = createRefreshBatcher((targets) => refresh(qc, targets), { leading: true });
    const { socket, dispose } = connectAuthedSocket(services, (s, isReconnect) => {
      for (const pid of key ? key.split(',') : []) s.emit('join', { projectId: pid });
      if (isReconnect) {
        chat.add([{ queryKey: ['chat'] }]);
        meetings.add(meetingsReconnectRefreshes());
      }
    });

    const onChat = (payload: ChatEventPayload) => chat.add(chatInvalidationKeys(payload).map((queryKey) => ({ queryKey })));
    for (const ev of CHAT_EVENTS) socket.on(ev, onChat);
    for (const ev of MEETING_EVENTS) socket.on(ev, (payload: unknown) => meetings.add(meetingEventRefreshes(ev, payload)));
    // Removed from a project: its channel, meetings and data are gone — refresh projects, chats,
    // meetings and tasks. (The new project list changes the joined rooms, which reconnects this socket.)
    socket.on(PROJECT_REMOVED_EVENT, () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['chat'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'] });
      meetings.add(meetingsReconnectRefreshes());
    });

    return () => {
      dispose();
      chat.flush();
      meetings.flush();
    };
    // Reconnect only when the joined rooms, the signed-in user or the services change.
  }, [key, userId, services, qc]);
}
