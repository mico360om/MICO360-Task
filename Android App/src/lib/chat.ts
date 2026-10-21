import type { ApiChatMessage, ApiConversationSummary, ApiDirectoryUser } from './types';
import type { MentionPerson } from './mentions';
import { ApiError, isNetworkError } from './api-client';

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


// ── 3a: read state, the badge, titles and who can be mentioned ──────────────────

/** The Chat tab's number: unread messages, without muted conversations or the one open on screen. */
export function chatBadgeCount(inbox: ApiConversationSummary[] | undefined, { viewing }: { viewing: string | null }): number {
  if (!Array.isArray(inbox)) return 0;
  return inbox.reduce((sum, s) => (s.prefs?.muted || s.conversation.id === viewing ? sum : sum + (s.unread || 0)), 0);
}

/** The inbox right after this conversation was read: its unread is 0 (the same list when it already was). */
export function withConversationRead(inbox: ApiConversationSummary[] | undefined, conversationId: string): ApiConversationSummary[] | undefined {
  if (!Array.isArray(inbox) || !inbox.some((s) => s.conversation.id === conversationId && s.unread > 0)) return inbox;
  return inbox.map((s) => (s.conversation.id === conversationId ? { ...s, unread: 0 } : s));
}

/** The project's channel as the inbox knows it (opened without asking the server), or null. */
export function conversationForProject(inbox: ApiConversationSummary[] | undefined, projectId: string): string | null {
  if (!Array.isArray(inbox)) return null;
  return inbox.find((s) => s.conversation.kind === 'PROJECT' && s.conversation.projectId === projectId)?.conversation.id ?? null;
}

/** A thread's title: the project's name, or the other person's; plain words while unknown. */
export function conversationTitle({
  summary,
  projects,
  nameOf,
  myId,
  fallback,
}: {
  summary: ApiConversationSummary | undefined;
  projects: ReadonlyArray<{ id: string; name: string }>;
  nameOf: (userId: string) => string;
  myId: string | null | undefined;
  fallback?: string;
}): string {
  if (!summary) return fallback || 'Chat';
  if (summary.conversation.kind === 'PROJECT') {
    return projects.find((p) => p.id === summary.conversation.projectId)?.name ?? (fallback || 'Project channel');
  }
  const other = summary.participants.find((p) => p.userId !== myId)?.userId;
  return other ? nameOf(other) : fallback || 'Direct message';
}

/**
 * Who is in the conversation: a direct one's two people (from the inbox), a channel's project
 * people (from the server). null while unknown.
 */
export function chatMemberIds({ summary, members }: { summary: ApiConversationSummary | undefined; members: string[] | undefined }): string[] | null {
  if (summary?.conversation.kind === 'DIRECT') return summary.participants.map((p) => p.userId);
  return Array.isArray(members) ? members : null;
}

/**
 * The people an @mention can name: the conversation's members (the server tells only them), never
 * yourself, and only active accounts. No one while the members are unknown.
 */
export function mentionPeopleFor(memberIds: readonly string[] | null, directory: readonly ApiDirectoryUser[], myId: string | null | undefined): MentionPerson[] {
  if (!memberIds) return [];
  const byId = new Map(directory.map((u) => [u.id, u]));
  const out: MentionPerson[] = [];
  for (const id of memberIds) {
    const u = byId.get(id);
    if (!u || id === myId || u.active === false) continue;
    out.push({ id: u.id, username: u.username, name: `${u.firstName} ${u.lastName}`.trim() });
  }
  return out;
}

/** Mark the open conversation read: it is on screen, the app is in front, and something is unread. */
export function shouldMarkRead({ focused, appActive, unread }: { focused: boolean; appActive: boolean; unread: number }): boolean {
  return focused && appActive && unread > 0;
}

/** The Chat tab's badge: the number (99+ at most), nothing at 0. */
export function chatTabBadge(n: number): number | string | undefined {
  if (n <= 0) return undefined;
  return n > 99 ? '99+' : n;
}

/** What TalkBack reads for the Chat tab. */
export function chatTabLabel(n: number): string {
  return n > 0 ? `Chat, ${n} unread message${n === 1 ? '' : 's'}` : 'Chat';
}

/** Why a project's channel couldn't be opened (it had to be asked of the server). */
export function openChannelError(error: unknown, name: string): string {
  if (isNetworkError(error)) return `Couldn’t open #${name} — you’re offline. Try again when connected.`;
  if (error instanceof ApiError && error.status === 403) {
    return `You can’t open #${name} because you aren’t a member of this project. Ask the project’s manager to add you to the team.`;
  }
  if (error instanceof ApiError && error.message && !/^Request failed/.test(error.message)) return error.message;
  return `Couldn’t open #${name}. Please try again.`;
}

/** Why a conversation didn't load: the server's reason for a refusal, else the connection. */
export function threadLoadError(error: unknown): string {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.message && !/^Request failed/.test(error.message)) return error.message;
  return 'Couldn’t load this conversation. Check your connection and try again.';
}
