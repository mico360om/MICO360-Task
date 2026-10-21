import type { QueryClient } from '@tanstack/react-query';
import { newestPageCopy, patchThreadMessage, upsertThreadMessage, type ThreadPages } from './chat-thread';
import { applyReaction } from './chat-realtime';
import type { QueuedMutation } from './sync-queue';
import type { ApiChatMessage } from './types';

/** A conversation's history in the query cache (pages, chat-thread). */
export const threadKey = (conversationId: string): string[] => ['chat', 'messages', conversationId];

export interface ChatCacheDeps {
  queryClient: QueryClient;
  /** Keep the thread's newest page on the phone, to read offline (offline-copy). */
  keepCopy?: (conversationId: string, newest: ApiChatMessage[]) => void;
  /** Change the newest page kept on the phone for a thread that isn't loaded (an edit or deletion of one of its messages). */
  reviseCopy?: (conversationId: string, change: (newest: ApiChatMessage[]) => ApiChatMessage[]) => void;
}

const isMessage = (v: unknown): v is ApiChatMessage =>
  !!v && typeof v === 'object' && typeof (v as ApiChatMessage).id === 'string' && typeof (v as ApiChatMessage).conversationId === 'string';

type Change = (data: ThreadPages | undefined) => ThreadPages | undefined;

/** The conversation a thread query is for, or null for another query. */
function threadOf(key: readonly unknown[]): string | null {
  return key[0] === 'chat' && key[1] === 'messages' && typeof key[2] === 'string' ? key[2] : null;
}

/**
 * Messages put into a loaded thread in place (3a): the server's copy of a message this phone sent,
 * and live events. The history is never fetched again for one message, and the offline copy is
 * kept up to date with what was seen.
 *
 * A thread being fetched again (back online, back in the app) is replaced by what the server held
 * when each page was read — so a message put in meanwhile (this phone's own, just sent) would vanish
 * (3a review). A change made while its thread is being fetched is made again once the fetch lands.
 * An edit or deletion for a thread that isn't loaded changes its offline copy, so retracted words
 * aren't kept on the phone.
 */
export function createChatCache({ queryClient, keepCopy, reviseCopy }: ChatCacheDeps) {
  /** Changes made while the thread was being fetched: made again on what the fetch brings. */
  const replays = new Map<string, Change[]>();

  const apply = (conversationId: string, fns: readonly Change[]): void => {
    const before = queryClient.getQueryData<ThreadPages>(threadKey(conversationId));
    const after = fns.reduce<ThreadPages | undefined>((d, fn) => fn(d) ?? d, before);
    if (!after || after === before) return;
    queryClient.setQueryData<ThreadPages>(threadKey(conversationId), after);
    keepCopy?.(conversationId, newestPageCopy(after));
  };

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const conversationId = threadOf(event.query.queryKey);
    if (!conversationId || !replays.has(conversationId)) return;
    const action = event.action as { type: string; manual?: boolean };
    // The fetch landed (or was put back): what was changed meanwhile is made again on it.
    if ((action.type === 'success' && !action.manual) || action.type === 'setState') {
      const fns = replays.get(conversationId)!;
      replays.delete(conversationId);
      apply(conversationId, fns);
    } else if (action.type === 'error') {
      replays.delete(conversationId);
    }
  });

  function change(conversationId: string, fn: Change): void {
    const state = queryClient.getQueryState(threadKey(conversationId));
    if (state && state.fetchStatus !== 'idle') replays.set(conversationId, [...(replays.get(conversationId) ?? []), fn]);
    apply(conversationId, [fn]);
  }

  /** A new or changed message (once, wherever it is). */
  const put = (conversationId: string, message: ApiChatMessage) => change(conversationId, (d) => upsertThreadMessage(d, message));

  /** Change one loaded message (an edit, a deletion, a reaction) — or, not loaded, its offline copy. */
  function patch(conversationId: string, id: string, fn: (m: ApiChatMessage) => ApiChatMessage): void {
    if (!queryClient.getQueryData<ThreadPages>(threadKey(conversationId))) {
      reviseCopy?.(conversationId, (newest) => newest.map((m) => (m.id === id ? fn(m) : m)));
      return;
    }
    change(conversationId, (d) => patchThreadMessage(d, id, fn));
  }

  /**
   * A queued chat change reached the server: a message's saved copy takes the waiting one's place;
   * an edit, deletion or reaction (3b) shows in the thread as the server now has it.
   */
  function afterSent(m: Pick<QueuedMutation, 'kind' | 'payload'> & { userId?: string }, result: unknown): void {
    if (m.kind === 'chat.send') {
      if (isMessage(result)) put(result.conversationId, result);
      return;
    }
    const p = (m.payload ?? {}) as { conversationId?: unknown; messageId?: unknown; emoji?: unknown; add?: unknown };
    if (typeof p.conversationId !== 'string' || typeof p.messageId !== 'string') return;
    const cid = p.conversationId;
    if (m.kind === 'chat.edit' && isMessage(result)) {
      patch(cid, p.messageId, (x) => ({ ...x, body: result.body, editedAt: result.editedAt ?? new Date().toISOString() }));
    } else if (m.kind === 'chat.delete') {
      patch(cid, p.messageId, (x) => ({ ...x, body: '', deletedAt: x.deletedAt ?? new Date().toISOString(), attachments: [], reactions: [] }));
    } else if (m.kind === 'chat.react' && typeof p.emoji === 'string' && m.userId) {
      const emoji = p.emoji;
      const who = m.userId;
      patch(cid, p.messageId, (x) => ({ ...x, reactions: applyReaction(x.reactions ?? [], emoji, who, p.add !== false) }));
    }
  }

  return { put, patch, afterSent };
}

export type ChatCache = ReturnType<typeof createChatCache>;
