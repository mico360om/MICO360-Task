/**
 * When a new chat message plays the chime: never for your own messages, with the sound off, in a
 * conversation you muted, or in the conversation open in front of you (you can see it arrive). And
 * only once per message, even with the app open in several tabs: the first tab to claim the
 * message in shared storage plays it.
 */

const CLAIM_PREFIX = 'mico360.chat.chimed.';
/** Claims older than this are forgotten. */
const CLAIM_TTL_MS = 2 * 60_000;

let viewing: string | null = null;

/** The chat page says which conversation it has open (null when none). */
export function setViewingConversation(conversationId: string | null): void {
  viewing = conversationId;
}
export function viewingConversation(): string | null {
  return viewing;
}

export function shouldChime(e: {
  authorId: string | undefined;
  myId: string | undefined;
  conversationId: string | undefined;
  soundOff: boolean;
  mutedIds: Set<string>;
  viewing: string | null;
  pageVisible: boolean;
}): boolean {
  if (!e.authorId || e.authorId === e.myId) return false;
  if (e.soundOff) return false;
  if (e.conversationId && e.mutedIds.has(e.conversationId)) return false;
  if (e.conversationId && e.viewing === e.conversationId && e.pageVisible) return false;
  return true;
}

/** True for the first claim of a message (in any tab); false after that. */
export function claimChime(messageId: string, now = Date.now()): boolean {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(CLAIM_PREFIX) && now - Number(localStorage.getItem(k)) > CLAIM_TTL_MS) localStorage.removeItem(k);
    }
    const key = CLAIM_PREFIX + messageId;
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, String(now));
    return true;
  } catch {
    return true; // no shared storage: this tab decides alone
  }
}
