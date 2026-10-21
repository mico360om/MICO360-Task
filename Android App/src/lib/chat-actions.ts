/**
 * What can be done with a chat message (3b), as on the website (MessageItem, ChatPage): react,
 * reply, copy the text, edit your own and delete your own (an admin: anyone's). Edits, deletions and
 * reactions made without a connection are kept on the phone and sent in order per message
 * (write-order: chatmsg:<id>); meanwhile the thread shows them over the loaded messages
 * (withQueuedChatChanges). Pure, so it is tested here.
 */
import { applyReaction } from './chat-realtime';
import type { QueuedMutation } from './sync-queue';
import type { ApiChatMessage, ReactionGroup, ReplyQuote } from './types';

export const CHAT_EDIT = 'chat.edit';
export const CHAT_DELETE = 'chat.delete';
export const CHAT_REACT = 'chat.react';

/** The server's longest message (and edit). */
const MAX = 4000;
/** The longest quote of an answered message (the server's). */
const QUOTE_LENGTH = 200;

const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface MessageActionSet {
  react: boolean;
  reply: boolean;
  copy: boolean;
  edit: boolean;
  remove: boolean;
}

/**
 * The website's rules: a message the server has (not one still on its way) and not deleted can be
 * reacted to and answered; its words copied; your own edited (no time limit, as on the website) and
 * deleted — an admin may delete anyone's.
 */
export function messageActions(m: ApiChatMessage & { pending?: string }, ctx: { myId: string; isAdmin: boolean }): MessageActionSet {
  const settled = !m.pending;
  const live = settled && !m.deletedAt;
  const hasText = live && m.body.trim().length > 0;
  const mine = m.userId === ctx.myId;
  return { react: live, reply: live, copy: hasText, edit: mine && hasText, remove: live && (mine || ctx.isAdmin) };
}

/** What's wrong with an edit, or null. */
export function editProblem(body: string): string | null {
  const text = body.trim();
  if (!text) return 'A message can’t be empty — delete it instead.';
  if (text.length > MAX) return `Messages can be up to ${withCommas(MAX)} characters. This one has ${withCommas(text.length)}.`;
  return null;
}

/** Asked before a message is deleted (the website's words). */
export function deleteDialog(m: Pick<ApiChatMessage, 'userId'>, myId: string, nameOf: (userId: string) => string) {
  return {
    title: 'Delete this message?',
    message: `${m.userId === myId ? 'It will be removed for everyone in the conversation.' : `${nameOf(m.userId)}’s message will be removed for everyone.`} This can’t be undone.`,
    confirm: 'Yes, delete',
    keep: 'Keep',
  };
}

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What TalkBack reads for a reaction chip: the emoji, how many, who, and what a tap does. */
export function reactionLabel(r: ReactionGroup, myId: string, nameOf: (userId: string) => string): string {
  const mine = r.userIds.includes(myId);
  const who = list(r.userIds.map((id) => (id === myId ? 'You' : nameOf(id))));
  return `${r.emoji} ${r.userIds.length}: ${who}. ${mine ? 'Tap to take back your reaction.' : `Tap to react with ${r.emoji} too.`}`;
}

/** The quote a reply carries (shown at once, before the server's own). */
export function replyQuoteOf(m: Pick<ApiChatMessage, 'id' | 'userId' | 'body' | 'deletedAt'>): ReplyQuote {
  return { id: m.id, userId: m.userId, body: m.deletedAt ? '' : m.body.slice(0, QUOTE_LENGTH), deleted: !!m.deletedAt };
}

type ChangePayload = { messageId?: unknown; body?: unknown; emoji?: unknown; add?: unknown };

/**
 * The thread's messages with this phone's waiting edits, deletions and reactions laid over them, in
 * the order they were made — so a change made offline shows at once and stays shown until it is sent.
 */
export function withQueuedChatChanges(messages: ApiChatMessage[], pending: readonly QueuedMutation[], myId: string): ApiChatMessage[] {
  const changes = pending.filter((m) => m.kind === CHAT_EDIT || m.kind === CHAT_DELETE || m.kind === CHAT_REACT);
  if (changes.length === 0) return messages;
  const byMessage = new Map<string, QueuedMutation[]>();
  for (const c of changes) {
    const id = (c.payload as ChangePayload | null)?.messageId;
    if (typeof id !== 'string') continue;
    byMessage.set(id, [...(byMessage.get(id) ?? []), c]);
  }
  if (byMessage.size === 0) return messages;
  return messages.map((m) => {
    const mine = byMessage.get(m.id);
    if (!mine) return m;
    return mine.reduce<ApiChatMessage>((x, c) => {
      const p = (c.payload ?? {}) as ChangePayload;
      if (c.kind === CHAT_DELETE) return { ...x, body: '', deletedAt: x.deletedAt ?? new Date(c.createdAt).toISOString(), reactions: [], attachments: [] };
      if (x.deletedAt) return x;
      if (c.kind === CHAT_EDIT && typeof p.body === 'string') return { ...x, body: p.body, editedAt: new Date(c.createdAt).toISOString() };
      if (c.kind === CHAT_REACT && typeof p.emoji === 'string') return { ...x, reactions: applyReaction(x.reactions ?? [], p.emoji, myId, p.add !== false) };
      return x;
    }, m);
  });
}
