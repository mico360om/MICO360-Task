import type { ConversationSummary } from '../api/chat';

/**
 * The Chat menu's number: unread messages, without muted conversations (their rows say Muted),
 * archived ones (shelved apart) or the one open on screen (it is being read). The same rule as
 * the Android app's Chat tab (Android App/src/lib/chat.ts chatBadgeCount).
 */
export function chatBadgeCount(inbox: ConversationSummary[] | undefined, { viewing }: { viewing: string | null }): number {
  if (!Array.isArray(inbox)) return 0;
  return inbox.reduce((sum, s) => {
    if (s.prefs?.muted || s.prefs?.archived || s.conversation?.id === viewing) return sum;
    const n = Number(s.unread);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);
}

/** The list right after this conversation was read: its unread is 0 (the same list when it already was). */
export function withConversationRead(inbox: ConversationSummary[] | undefined, conversationId: string): ConversationSummary[] | undefined {
  if (!Array.isArray(inbox) || !inbox.some((s) => s.conversation.id === conversationId && s.unread > 0)) return inbox;
  return inbox.map((s) => (s.conversation.id === conversationId ? { ...s, unread: 0 } : s));
}

/** What the badge shows: nothing at 0, the number up to 99, then "99+". */
export function chatBadgeText(n: number): string | null {
  if (n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

const messages = (n: number) => `${n} unread ${n === 1 ? 'message' : 'messages'}`;

/** What screen readers hear for the Chat link. */
export function chatNavLabel(n: number): string {
  return n > 0 ? `Chat, ${messages(n)}` : 'Chat';
}

/** What screen readers hear for the phone's menu button (the sidebar, and its badge, are hidden behind it). */
export function menuButtonLabel(n: number): string {
  return n > 0 ? `Open menu, ${n} unread chat ${n === 1 ? 'message' : 'messages'}` : 'Open menu';
}
