/**
 * Chat realtime wiring (A2.3), mirroring the web app's socket event names. The board has its own
 * realtime (see useBoardRealtime); this is the user/DM + project-channel side. The backend emits
 * these to the socket's project rooms (channel messages) and to the auto-joined `user:<id>` room
 * (direct messages). Pure so the invalidation logic is unit-testable; the RN socket lives in
 * core/useChatRealtime.
 */
export const CHAT_EVENTS = [
  'chat:message',
  'chat:message:edited',
  'chat:message:deleted',
  'chat:reaction',
  'chat:read',
] as const;

export type ChatEvent = (typeof CHAT_EVENTS)[number];

export interface ChatEventPayload {
  conversationId?: string;
  [k: string]: unknown;
}

/**
 * The React-Query keys to invalidate when a chat event arrives: always the inbox (conversation
 * list + unread counts), plus the affected thread's messages when the payload names a conversation.
 */
export function chatInvalidationKeys(payload: ChatEventPayload | undefined): string[][] {
  const keys: string[][] = [['chat', 'conversations']];
  const id = typeof payload?.conversationId === 'string' ? payload.conversationId : undefined;
  if (id) keys.push(['chat', 'messages', id]);
  return keys;
}
