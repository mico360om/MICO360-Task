import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useMyQueuedChanges, useServices } from './providers';
import { enqueueChatMessage, outboxFor, settledByServer } from '../lib/chat-outbox';
import { chatBadgeCount, conversationForProject, openChannelError, shouldMarkRead, withConversationRead } from '../lib/chat';
import { appCovered, canReadOnScreen, setViewingConversation, stopViewing, subscribeViewing, viewingConversation } from '../lib/chat-viewing';
import { useConversations } from './queries';
import { newIdempotencyKey } from '../lib/idempotency';
import { refresh } from '../lib/refresh';
import { dismissNotificationsAbout } from '../adapters/push';
import type { ApiConversationSummary } from '../lib/types';

/** Is the server reachable, as far as the app can tell (connectivity), live. */
export function useOnline(): boolean {
  const { connectivity } = useServices();
  const subscribe = useCallback((onChange: () => void) => connectivity.subscribe(() => onChange()), [connectivity]);
  return useSyncExternalStore(subscribe, connectivity.isOnline, connectivity.isOnline);
}

/** Is the app in front (not in the background), live. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * A conversation's outbox (chat-outbox): its messages still on this phone, and sending, retrying
 * and discarding them. `confirmed` holds the client ids of the messages the thread has loaded.
 */
export function useChatOutbox(conversationId: string, confirmed: ReadonlySet<string>) {
  const { queue, sync, currentUserId } = useServices();
  const mine = useMyQueuedChanges();
  const online = useOnline();
  const entries = useMemo(() => outboxFor(conversationId, mine, { online, confirmed }), [conversationId, mine, online, confirmed]);

  // A refused message whose saved copy is in the thread after all (an earlier try got through).
  useEffect(() => {
    for (const id of settledByServer(mine.failed, confirmed)) void queue.discard(id);
  }, [mine.failed, confirmed, queue]);

  const send = useCallback(
    (text: string) =>
      enqueueChatMessage({ queue, sync: () => void sync.trigger(), userId: currentUserId, newKey: () => newIdempotencyKey() }, conversationId, text),
    [queue, sync, currentUserId, conversationId],
  );
  const retry = useCallback(
    (queueId: string) => {
      void queue.retry(queueId).then(() => sync.trigger());
    },
    [queue, sync],
  );
  const discard = useCallback(
    (queueId: string) => {
      void queue.discard(queueId);
    },
    [queue],
  );
  const waiting = entries.filter((e) => e.state !== 'failed').length;
  return { entries, send, retry, discard, waiting };
}

const INBOX = ['chat', 'conversations'];

/**
 * Tell the server a conversation was read. Then the inbox shows it read at once (the Chat tab's
 * number with it), the phone's notifications about it go, and — when it had unread messages — the
 * Alerts list is fetched again (the server marks its notifications read). Best effort: offline, the
 * number stays until the next read that gets through.
 */
export function useMarkRead() {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useCallback(
    (conversationId: string) => {
      const before = qc.getQueryData<ApiConversationSummary[]>(INBOX);
      const hadUnread = !!before?.some((s) => s.conversation.id === conversationId && s.unread > 0);
      resources.chat.markRead(conversationId).then(
        () => {
          qc.setQueryData<ApiConversationSummary[]>(INBOX, (inbox) => withConversationRead(inbox, conversationId));
          refresh(qc, [{ queryKey: INBOX }, ...(hadUnread ? [{ queryKey: ['notifications'] }] : [])]);
          void dismissNotificationsAbout('conversation', conversationId);
        },
        () => {
          /* offline or refused: the unread number stays until a read gets through */
        },
      );
    },
    [resources, qc],
  );
}

/**
 * While a conversation is open on screen with the app in front (3a): it is read as it opens, and
 * messages that arrive while it is open are read too (after a short pause, like the website). It is
 * also "the conversation on screen" (chat-viewing): no second alert for its pushes, and the Chat
 * tab's number leaves it out.
 */
export function useReadWhileOpen({ conversationId, unread, newestId, focused }: { conversationId: string; unread: number; newestId: string | undefined; focused: boolean }) {
  const appActive = useAppActive();
  const markRead = useMarkRead();
  // Behind the fingerprint lock (or its cover) nobody sees the thread: it isn't read (3a review).
  const covered = useSyncExternalStore(subscribeViewing, appCovered, appCovered);
  const open = canReadOnScreen({ focused, appActive, covered });

  useEffect(() => {
    if (!open) return;
    setViewingConversation(conversationId);
    markRead(conversationId);
    return () => stopViewing(conversationId);
  }, [open, conversationId, markRead]);

  useEffect(() => {
    if (!open || !shouldMarkRead({ focused, appActive, unread })) return;
    const t = setTimeout(() => markRead(conversationId), 800);
    return () => clearTimeout(t);
  }, [open, focused, appActive, unread, newestId, conversationId, markRead]);
}

/** The Chat tab's number, live: unread messages without muted conversations or the one on screen. */
export function useChatBadge(): number {
  // The same inbox query as the Chat screen (one request, one cache entry).
  const inbox = useConversations().data;
  const viewing = useSyncExternalStore(subscribeViewing, viewingConversation, viewingConversation);
  return chatBadgeCount(inbox, { viewing });
}

/**
 * Open a project's channel: straight away when the inbox knows it (works offline, from its copy),
 * otherwise once the server has made it. The thread marks it read as it opens (useReadWhileOpen).
 */
export function useOpenProjectChat(go: (conversationId: string, name: string) => void) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(
    async (projectId: string, name: string) => {
      if (opening) return;
      setError(null);
      const known = conversationForProject(qc.getQueryData<ApiConversationSummary[]>(INBOX), projectId);
      if (known) {
        go(known, name);
        return;
      }
      setOpening(projectId);
      try {
        const { conversation } = await resources.chat.openProjectChannel(projectId);
        void qc.invalidateQueries({ queryKey: INBOX });
        go(conversation.id, name);
      } catch (e) {
        setError(openChannelError(e, name));
      } finally {
        setOpening(null);
      }
    },
    [opening, qc, resources, go],
  );
  return { open, opening, error };
}
