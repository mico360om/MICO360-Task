import { CACHE_PREFIX } from './read-cache';
import type { KeyValueStore } from './storage';

/**
 * Each conversation's unsent message, kept on this phone (3b), as the website keeps it in the
 * browser: typed, left, and back again on return. One person's: it is stored under their id (a
 * second person signed in on the phone never sees it) and with the phone's offline copy, so signing
 * out removes it with the rest (read-cache clear). An empty box forgets it.
 */
export function createChatDrafts({ store, getUserId }: { store: KeyValueStore; getUserId: () => string | null | undefined }) {
  const keyOf = (userId: string, conversationId: string) => `${CACHE_PREFIX}${userId}.chatdraft.${conversationId}`;
  return {
    /** The conversation's unsent text ('' when none). */
    async load(conversationId: string): Promise<string> {
      const userId = getUserId();
      if (!userId) return '';
      return (await store.getItem(keyOf(userId, conversationId)).catch(() => null)) ?? '';
    },
    /** Keep (or, empty, forget) the conversation's unsent text. */
    async save(conversationId: string, text: string): Promise<void> {
      const userId = getUserId();
      if (!userId) return;
      const key = keyOf(userId, conversationId);
      await (text.trim() ? store.setItem(key, text) : store.deleteItem(key)).catch(() => {
        /* storage unavailable: the draft lives only on screen */
      });
    },
  };
}

export type ChatDrafts = ReturnType<typeof createChatDrafts>;
