import type { ApiChatMessage, ApiConversationSummary } from './types';

/** Realtime chat events broadcast by the API over socket.io (mirrors server event names). */
export type ChatEvent =
  | { type: 'chat:message'; payload: { conversationId: string; message: ApiChatMessage } }
  | { type: 'chat:message:edited'; payload: { conversationId: string; message: ApiChatMessage } }
  | { type: 'chat:message:deleted'; payload: { conversationId: string; id: string } }
  | { type: 'chat:reaction'; payload: { conversationId: string; messageId: string } };

function upsert(messages: ApiChatMessage[], message: ApiChatMessage): ApiChatMessage[] {
  const idx = messages.findIndex((m) => m.id === message.id);
  if (idx === -1) return [...messages, message];
  const next = messages.slice();
  next[idx] = message;
  return next;
}

/**
 * Fold a realtime chat event into one conversation's message list. Events for another
 * conversation return the same array reference untouched. Create/edit upsert (idempotent
 * under duplicates); delete tombstones the message; a reaction event only signals that the
 * conversation should be refetched (payload lacks full reaction state), so the list is unchanged.
 */
export function applyChatEvent(conversationId: string, messages: ApiChatMessage[], event: ChatEvent): ApiChatMessage[] {
  if (event.payload.conversationId !== conversationId) return messages;
  switch (event.type) {
    case 'chat:message':
    case 'chat:message:edited':
      return upsert(messages, event.payload.message);
    case 'chat:message:deleted':
      return messages.map((m) => (m.id === event.payload.id ? { ...m, deletedAt: new Date().toISOString() } : m));
    case 'chat:reaction':
    default:
      return messages;
  }
}

/** Total unread messages across all conversations (for a tab badge). */
export function unreadTotal(summaries: ApiConversationSummary[]): number {
  return summaries.reduce((sum, s) => sum + (s.unread || 0), 0);
}
