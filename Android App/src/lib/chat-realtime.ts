import type { KeyRefresh } from './refresh';
import type { ApiChatMessage, ReactionGroup } from './types';

/**
 * Chat realtime wiring (A2.3), mirroring the web app's socket event names. The board has its own
 * realtime (see useBoardRealtime); this is the user/DM + project-channel side. The backend emits
 * these to the socket's project rooms (channel messages) and to the auto-joined `user:<id>` room
 * (direct messages). Pure so it is unit-testable; the RN socket (shared with the meeting events)
 * lives in core/useAppRealtime.
 *
 * Since 3a an event changes the loaded thread in place (chat-cache) — a new message is put in by
 * id, so the copy this phone sent and the live one are one message — and only the inbox (last
 * message, unread numbers) is fetched again. The history is never reloaded for one event.
 */
export const CHAT_EVENTS = [
  'chat:message',
  'chat:message:edited',
  'chat:message:deleted',
  'chat:reaction',
  'chat:read',
  'chat:delivered',
] as const;

export type ChatEvent = (typeof CHAT_EVENTS)[number];

export interface ChatEventPayload {
  conversationId?: unknown;
  [k: string]: unknown;
}

/** What one event does: put a message in, change one, and what to fetch again. */
export interface ChatEventPlan {
  put?: { conversationId: string; message: ApiChatMessage };
  patch?: { conversationId: string; id: string; change: (m: ApiChatMessage) => ApiChatMessage };
  refresh: KeyRefresh[];
}

const INBOX: KeyRefresh = { queryKey: ['chat', 'conversations'] };
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const isMessage = (v: unknown): v is ApiChatMessage =>
  !!v && typeof v === 'object' && typeof (v as ApiChatMessage).id === 'string' && typeof (v as ApiChatMessage).createdAt === 'string';

/** Reactions after one person adds or takes back an emoji (like the website). */
export function applyReaction(groups: readonly ReactionGroup[], emoji: string, userId: string, add: boolean): ReactionGroup[] {
  const list = groups.map((g) => ({ ...g, userIds: [...g.userIds] }));
  const g = list.find((x) => x.emoji === emoji);
  if (add) {
    if (!g) list.push({ emoji, userIds: [userId] });
    else if (!g.userIds.includes(userId)) g.userIds.push(userId);
    return list;
  }
  if (g) g.userIds = g.userIds.filter((u) => u !== userId);
  return list.filter((x) => x.userIds.length > 0);
}

/** How one live chat event changes what the phone holds. */
export function chatEventPlan(event: ChatEvent, payload: ChatEventPayload | undefined, myId: string | null | undefined): ChatEventPlan {
  const conversationId = str(payload?.conversationId);
  if (!conversationId) return { refresh: [{ queryKey: ['chat'] }] };
  const fallback: ChatEventPlan = { refresh: [INBOX, { queryKey: ['chat', 'messages', conversationId] }] };
  const p = payload!;
  switch (event) {
    case 'chat:message': {
      if (!isMessage(p.message)) return fallback;
      return { put: { conversationId, message: { ...p.message, conversationId } }, refresh: [INBOX] };
    }
    case 'chat:message:edited': {
      const m = p.message;
      if (!isMessage(m)) return fallback;
      return { patch: { conversationId, id: m.id, change: (x) => ({ ...x, body: m.body, editedAt: m.editedAt ?? new Date().toISOString() }) }, refresh: [INBOX] };
    }
    case 'chat:message:deleted': {
      const id = str(p.id);
      if (!id) return fallback;
      return {
        patch: { conversationId, id, change: (x) => ({ ...x, body: '', deletedAt: x.deletedAt ?? new Date().toISOString(), attachments: [], reactions: [] }) },
        refresh: [INBOX],
      };
    }
    case 'chat:reaction': {
      const id = str(p.messageId);
      const emoji = str(p.emoji);
      const userId = str(p.userId);
      if (!id || !emoji || !userId) return fallback;
      const add = p.op !== 'remove';
      return { patch: { conversationId, id, change: (x) => ({ ...x, reactions: applyReaction(x.reactions ?? [], emoji, userId, add) }) }, refresh: [] };
    }
    case 'chat:read':
      // My reading on another device (the unread numbers), or someone else's (my messages' receipts,
      // from the list's participants — 3b): the list is fetched again.
      return { refresh: [INBOX] };
    case 'chat:delivered':
      // Their app received my messages: "Delivered" (3b). My own phone saying so changes nothing.
      return { refresh: str(p.userId) === myId ? [] : [INBOX] };
    default:
      return fallback;
  }
}
