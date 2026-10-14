import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { projectsApi } from '../api/projects';
import { useAuthStore } from '../stores/auth-store';
import { useChatRealtime, type ChatEventPayload } from '../lib/useChatRealtime';
import { playChime, isChatMuted, primeAudio } from '../lib/notificationSound';
import { NOTIFICATIONS_KEY, UNREAD_COUNT_KEY } from '../api/notifications';
import { chatApi, type ConversationSummary } from '../api/chat';
import { claimChime, shouldChime, viewingConversation } from '../lib/chat-sound';
import { needsDeliveryAck } from '../lib/chat-model';

/** How long after a message the bell is refreshed: time for the server to store its notification, and one refresh for a burst. */
const BELL_REFRESH_DELAY_MS = 1200;

/**
 * App-wide chat sound notifier (renders nothing). Subscribes to chat realtime events and plays
 * a chime for incoming messages from other people — on any page — unless the user has muted it.
 * It also refreshes the notification bell right after such a message, instead of leaving it to the
 * bell's 30-second poll. Mounted once in the app shell.
 *
 * It keeps the conversation list loaded on every page too: that is where your per-conversation
 * mute lives, and how this app tells the server a direct message has reached it (its sender then
 * sees "Delivered" instead of "Sent").
 */
export function ChatSoundNotifier() {
  const myId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const bellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (bellTimer.current) clearTimeout(bellTimer.current); }, []);
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  // Defensive: never let an unexpected projects payload crash the app shell.
  const projectIds = Array.isArray(projectsQ.data) ? projectsQ.data.map((p) => p.id) : [];
  const inboxQ = useQuery({ queryKey: ['chat', 'conversations'], queryFn: () => chatApi(apiClient).conversations(), enabled: !!myId });

  // Report each newly received direct message once (a failed report is tried again next time).
  const acked = useRef(new Set<string>());
  useEffect(() => {
    if (!myId || !Array.isArray(inboxQ.data)) return;
    for (const s of inboxQ.data) {
      if (!needsDeliveryAck(s, myId)) continue;
      const key = `${s.conversation.id}:${s.lastMessage!.id}`;
      if (acked.current.has(key)) continue;
      acked.current.add(key);
      void chatApi(apiClient).markDelivered(s.conversation.id).catch(() => acked.current.delete(key));
    }
  }, [inboxQ.data, myId]);

  // Browsers block audio until a user gesture — resume the audio context on first interaction.
  useEffect(() => {
    const onGesture = () => primeAudio();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);

  useChatRealtime(projectIds, (event: string, payload: ChatEventPayload) => {
    if (event !== 'chat:message') return;
    const message = (payload as { message?: { id?: string; userId?: string } }).message;
    const authorId = message?.userId;
    if (!authorId || authorId === myId) return; // nothing to announce for your own messages
    // Unread counts, a conversation that is new to this person, and the delivery report above.
    void qc.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    // A direct message or a mention has just created a notification: show it now (once per burst).
    if (!bellTimer.current) {
      bellTimer.current = setTimeout(() => {
        bellTimer.current = null;
        void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
        void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      }, BELL_REFRESH_DELAY_MS);
    }
    const inbox = qc.getQueryData<ConversationSummary[]>(['chat', 'conversations']);
    const mutedIds = new Set((Array.isArray(inbox) ? inbox : []).filter((s) => s.prefs?.muted).map((s) => s.conversation.id));
    const chime = shouldChime({
      authorId,
      myId,
      conversationId: payload.conversationId,
      soundOff: isChatMuted(),
      mutedIds,
      viewing: viewingConversation(),
      pageVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    });
    // One chime per message: a repeated event, or the same message in another tab, stays quiet.
    if (chime && claimChime(message?.id ?? `${payload.conversationId}:${Date.now()}`)) playChime();
  });

  return null;
}
