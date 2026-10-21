import type { QueryClient } from '@tanstack/react-query';
import { newestPageCopy, patchThreadMessage, upsertThreadMessage, type ThreadPages } from './chat-thread';
import type { QueuedMutation } from './sync-queue';
import type { ApiChatMessage } from './types';

/** A conversation's history in the query cache (pages, chat-thread). */
export const threadKey = (conversationId: string): string[] => ['chat', 'messages', conversationId];

export interface ChatCacheDeps {
  queryClient: QueryClient;
  /** Keep the thread's newest page on the phone, to read offline (offline-copy). */
  keepCopy?: (conversationId: string, newest: ApiChatMessage[]) => void;
}

const isMessage = (v: unknown): v is ApiChatMessage =>
  !!v && typeof v === 'object' && typeof (v as ApiChatMessage).id === 'string' && typeof (v as ApiChatMessage).conversationId === 'string';

/**
 * Messages put into a loaded thread in place (3a): the server's copy of a message this phone sent,
 * and live events. The history is never fetched again for one message, and the offline copy is
 * kept up to date with what was seen.
 */
export function createChatCache({ queryClient, keepCopy }: ChatCacheDeps) {
  function change(conversationId: string, fn: (data: ThreadPages | undefined) => ThreadPages | undefined): void {
    const before = queryClient.getQueryData<ThreadPages>(threadKey(conversationId));
    const after = fn(before);
    if (!after || after === before) return;
    queryClient.setQueryData<ThreadPages>(threadKey(conversationId), after);
    keepCopy?.(conversationId, newestPageCopy(after));
  }

  /** A new or changed message (once, wherever it is). */
  const put = (conversationId: string, message: ApiChatMessage) => change(conversationId, (d) => upsertThreadMessage(d, message));

  /** Change one loaded message (an edit, a deletion, a reaction). */
  const patch = (conversationId: string, id: string, fn: (m: ApiChatMessage) => ApiChatMessage) =>
    change(conversationId, (d) => patchThreadMessage(d, id, fn));

  /** A queued message reached the server: its saved copy takes the waiting one's place. */
  function afterSent(m: Pick<QueuedMutation, 'kind' | 'payload'>, result: unknown): void {
    if (m.kind !== 'chat.send' || !isMessage(result)) return;
    put(result.conversationId, result);
  }

  return { put, patch, afterSent };
}

export type ChatCache = ReturnType<typeof createChatCache>;
