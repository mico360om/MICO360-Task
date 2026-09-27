import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { Logger } from '../../lib/logger';
import type {
  Conversation,
  Message,
  Participant,
  MessageAttachmentRecord,
  StoredFileMeta,
  ConversationRepository,
  ParticipantRepository,
  MessageRepository,
  ReactionRepository,
  ChatAttachmentRepository,
  ChatMemberLookup,
} from './chat-repository';
import type { AttachmentStorage } from '../tasks/attachment-repository';

const ATTACHMENT_URL_PREFIX = '/uploads';
type AttachmentView = MessageAttachmentRecord & { url: string };

/** Longest message body (after trimming) — the same limit applies to attachment captions. */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Extract @mention candidates from a message body (for mention notifications). Usernames are
 * free-form and may be Arabic, so a handle is any run of letters, marks, digits, '_', '.', '-';
 * an '@' inside a word (an email address) is not a mention. "@ahmed.ali" yields "ahmed.ali",
 * never "ahmed"; trailing punctuation ("thanks @sara.") is also offered stripped. Callers match
 * the candidates against real usernames.
 */
export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(/(?<![\p{L}\p{M}\p{N}_.@-])@([\p{L}\p{M}\p{N}_.-]+)/gu)) {
    const raw = match[1]!;
    const stripped = raw.replace(/[.-]+$/u, '');
    if (stripped) out.add(stripped);
    if (raw !== stripped) out.add(raw);
  }
  return [...out];
}

export interface ReactionGroup {
  emoji: string;
  userIds: string[];
}

/** A message enriched with its grouped reactions + attachments, as returned to clients. */
export interface MessageView extends Message {
  reactions: ReactionGroup[];
  attachments: AttachmentView[];
}

export interface ConversationSummary {
  conversation: Conversation;
  participants: Participant[];
  unread: number;
  lastMessage: Message | null;
}

export interface MentionEvent {
  conversationId: string;
  message: Message;
  authorId: string;
  usernames: string[];
}
export interface DirectMessageEvent {
  conversationId: string;
  message: Message;
  authorId: string;
  recipientId: string;
}

export interface MessageServiceDeps {
  conversations: ConversationRepository;
  participants: ParticipantRepository;
  messages: MessageRepository;
  reactions: ReactionRepository;
  members: ChatMemberLookup;
  /** Optional: persist/list file attachments on messages. */
  attachments?: ChatAttachmentRepository;
  /** Optional: physical file storage — lets a message delete also remove its attachment files. */
  storage?: AttachmentStorage;
  /** Fired when a message @mentions usernames (used to notify the mentioned users). */
  onMention?: (e: MentionEvent) => void | Promise<void>;
  /** Fired when a DM is sent (used to notify the recipient). */
  onDirectMessage?: (e: DirectMessageEvent) => void | Promise<void>;
  /** Where failed (best-effort) notification hooks are reported. */
  logger?: Pick<Logger, 'error'>;
}

const DEFAULT_LIMIT = 50;

/** A deleted message keeps its row (history order, reply context) but none of its content. */
function redact<M extends Message>(m: M): M {
  return m.deletedAt ? { ...m, body: '' } : m;
}

export function createMessageService(deps: MessageServiceDeps) {
  const { conversations, participants, messages, reactions, members } = deps;

  async function load(conversationId: string): Promise<Conversation> {
    const c = await conversations.findById(conversationId);
    if (!c) throw new NotFoundError('Conversation not found.');
    return c;
  }

  /**
   * A PROJECT conversation follows project visibility (owner, manager, creator, member, admin);
   * a DIRECT one is open to its participants only.
   */
  async function canAccess(conv: Conversation, userId: string): Promise<boolean> {
    if (conv.kind === 'PROJECT') return conv.projectId ? members.canAccessProject(conv.projectId, userId) : false;
    return (await participants.find(conv.id, userId)) !== null;
  }
  async function assertAccess(conv: Conversation, userId: string): Promise<void> {
    if (!(await canAccess(conv, userId))) throw new ForbiddenError('You do not have access to this conversation.');
  }

  /** Can this user read the conversation right now? (Used to filter mention recipients.) */
  async function canUserAccessConversation(conversationId: string, userId: string): Promise<boolean> {
    const conv = await conversations.findById(conversationId);
    return conv ? canAccess(conv, userId) : false;
  }

  /** Throws unless the user may post to the conversation — checked before an upload is stored. */
  async function assertCanPost(conversationId: string, userId: string): Promise<void> {
    await assertAccess(await load(conversationId), userId);
  }

  function cleanBody(body: string, allowEmpty: boolean): string {
    const text = (body ?? '').trim();
    if (!text && !allowEmpty) throw new ValidationError('A message cannot be empty.');
    if (text.length > MAX_MESSAGE_LENGTH) throw new ValidationError(`A message can be at most ${MAX_MESSAGE_LENGTH} characters.`);
    return text;
  }

  /** Run a notification hook without letting its failure undo (or duplicate) a saved message. */
  async function bestEffort(what: string, run: () => void | Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      deps.logger?.error(`chat ${what} notification failed`, { err });
    }
  }

  async function getOrCreateProjectConversation(projectId: string, userId: string): Promise<Conversation> {
    if (!(await members.canAccessProject(projectId, userId))) {
      throw new ForbiddenError('You do not have access to this project’s chat.');
    }
    const existing = await conversations.findProjectConversation(projectId);
    const conv = existing ?? (await conversations.createProject(projectId));
    // Lazily record a participant row so read-state (lastReadAt) has somewhere to live.
    await participants.add(conv.id, userId);
    return conv;
  }

  async function getOrCreateDirectConversation(userId: string, otherUserId: string): Promise<Conversation> {
    if (userId === otherUserId) throw new ValidationError('You cannot start a conversation with yourself.');
    const existing = await conversations.findDirectConversation(userId, otherUserId);
    if (existing) return existing;
    if (!(await members.isActiveUser(otherUserId))) throw new NotFoundError('User not found.');
    const conv = await conversations.createDirect();
    await participants.add(conv.id, userId);
    await participants.add(conv.id, otherUserId);
    return conv;
  }

  async function sendMessage(
    conversationId: string,
    userId: string,
    body: string,
    attachment?: StoredFileMeta,
  ): Promise<Message> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    // A caption may be empty when a file is attached; a plain message may not.
    const text = cleanBody(body, !!attachment);
    const message = await messages.create(conversationId, userId, text);
    if (attachment && deps.attachments) await deps.attachments.create(message.id, attachment);

    const usernames = parseMentions(text);
    if (usernames.length > 0) {
      await bestEffort('mention', () => deps.onMention?.({ conversationId, message, authorId: userId, usernames }));
    }

    if (conv.kind === 'DIRECT') {
      const others = (await participants.listByConversation(conversationId)).filter((p) => p.userId !== userId);
      for (const p of others) {
        await bestEffort('direct message', () => deps.onDirectMessage?.({ conversationId, message, authorId: userId, recipientId: p.userId }));
      }
    }
    return message;
  }

  async function listMessages(
    conversationId: string,
    userId: string,
    opts?: { before?: Date; limit?: number },
  ): Promise<{ messages: MessageView[] }> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    const page = await messages.list(conversationId, { before: opts?.before, limit: opts?.limit ?? DEFAULT_LIMIT });
    const ordered = [...page].reverse(); // repo returns newest-first; display oldest-first
    const ids = ordered.filter((m) => !m.deletedAt).map((m) => m.id);
    const rows = await reactions.listByMessages(ids);
    const byMessage = new Map<string, Map<string, string[]>>();
    for (const r of rows) {
      const emojis = byMessage.get(r.messageId) ?? new Map<string, string[]>();
      const users = emojis.get(r.emoji) ?? [];
      users.push(r.userId);
      emojis.set(r.emoji, users);
      byMessage.set(r.messageId, emojis);
    }
    const attachmentRows = deps.attachments ? await deps.attachments.listByMessages(ids) : [];
    const attByMessage = new Map<string, AttachmentView[]>();
    for (const a of attachmentRows) {
      const list = attByMessage.get(a.messageId) ?? [];
      list.push({ ...a, url: `${ATTACHMENT_URL_PREFIX}/${a.storageKey}` });
      attByMessage.set(a.messageId, list);
    }
    // Deleted messages come back as tombstones: deletedAt set, no text, reactions or files.
    const view = ordered.map<MessageView>((m) => ({
      ...redact(m),
      reactions: m.deletedAt ? [] : [...(byMessage.get(m.id)?.entries() ?? [])].map(([emoji, userIds]) => ({ emoji, userIds })),
      attachments: m.deletedAt ? [] : attByMessage.get(m.id) ?? [],
    }));
    return { messages: view };
  }

  async function messageConversation(messageId: string): Promise<{ message: Message; conv: Conversation }> {
    const message = await messages.findById(messageId);
    if (!message) throw new NotFoundError('Message not found.');
    const conv = await load(message.conversationId);
    return { message, conv };
  }

  async function editMessage(messageId: string, userId: string, body: string): Promise<Message> {
    const { message: m, conv } = await messageConversation(messageId);
    if (m.deletedAt) throw new ValidationError('You cannot edit a deleted message.');
    if (m.userId !== userId) throw new ForbiddenError('You can only edit your own message.');
    // Authors who have since lost access to the conversation can't rewrite its history.
    await assertAccess(conv, userId);
    const text = cleanBody(body, false);
    return messages.update(messageId, text);
  }

  async function deleteMessage(messageId: string, userId: string, canModerate: boolean): Promise<Message> {
    const { message: m, conv } = await messageConversation(messageId);
    if (m.userId !== userId && !canModerate) throw new ForbiddenError('You can only delete your own message.');
    if (!canModerate) await assertAccess(conv, userId);
    // Purge attachment files + rows so a deleted message leaves nothing downloadable on the server.
    if (deps.attachments) {
      const atts = await deps.attachments.listByMessages([messageId]);
      if (deps.storage) for (const a of atts) await deps.storage.remove(a.storageKey).catch(() => {});
      await deps.attachments.deleteByMessage(messageId);
    }
    return redact(await messages.softDelete(messageId));
  }

  async function addReaction(messageId: string, userId: string, emoji: string): Promise<{ conversationId: string }> {
    const { message, conv } = await messageConversation(messageId);
    await assertAccess(conv, userId);
    if (message.deletedAt) throw new ValidationError('You cannot react to a deleted message.');
    await reactions.add(messageId, userId, emoji);
    return { conversationId: message.conversationId };
  }
  async function removeReaction(messageId: string, userId: string, emoji: string): Promise<{ conversationId: string }> {
    const { message, conv } = await messageConversation(messageId);
    await assertAccess(conv, userId);
    await reactions.remove(messageId, userId, emoji);
    return { conversationId: message.conversationId };
  }

  async function markRead(conversationId: string, userId: string): Promise<void> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    // Read up to the latest message (or now), whichever is later — robust to clock skew.
    let at = new Date();
    const latest = await messages.latest(conversationId);
    if (latest && latest.createdAt > at) at = latest.createdAt;
    await participants.setLastRead(conversationId, userId, at);
  }

  async function unreadCount(conversationId: string, userId: string): Promise<number> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    const p = await participants.find(conversationId, userId);
    return messages.countAfter(conversationId, p?.lastReadAt ?? null, userId);
  }

  async function listConversations(userId: string): Promise<ConversationSummary[]> {
    // DMs come from participant rows; project channels from the projects the user can see NOW —
    // a stale participant row from a project they've left grants nothing.
    const [participantConvs, projectConvs] = await Promise.all([
      participants.listConversationIdsForUser(userId).then((ids) => conversations.listByIds(ids)),
      members.accessibleProjectIds(userId).then((ids) => conversations.listProjectConversations(ids)),
    ]);
    const byId = new Map<string, Conversation>();
    for (const c of participantConvs) if (c.kind === 'DIRECT') byId.set(c.id, c);
    for (const c of projectConvs) byId.set(c.id, c);
    const summaries = await Promise.all(
      [...byId.values()].map(async (conversation) => {
        const p = await participants.find(conversation.id, userId);
        const latest = await messages.latest(conversation.id);
        return {
          conversation,
          participants: await participants.listByConversation(conversation.id),
          unread: await messages.countAfter(conversation.id, p?.lastReadAt ?? null, userId),
          lastMessage: latest ? redact(latest) : null,
        };
      }),
    );
    // Most recently active first.
    return summaries.sort(
      (a, b) => (b.lastMessage?.createdAt.getTime() ?? 0) - (a.lastMessage?.createdAt.getTime() ?? 0),
    );
  }

  /** A user left a project: drop their channel participant row so nothing lingers in their inbox. */
  async function removeProjectParticipant(projectId: string, userId: string): Promise<void> {
    const conv = await conversations.findProjectConversation(projectId);
    if (conv) await participants.remove(conv.id, userId);
  }

  /** Where a conversation's realtime events should be delivered (project room, or each DM user). */
  async function conversationTargets(
    conversationId: string,
  ): Promise<{ kind: Conversation['kind'] | null; projectId: string | null; userIds: string[] }> {
    const conv = await conversations.findById(conversationId);
    if (!conv) return { kind: null, projectId: null, userIds: [] };
    const ps = await participants.listByConversation(conversationId);
    return { kind: conv.kind, projectId: conv.projectId, userIds: ps.map((p) => p.userId) };
  }

  return {
    getOrCreateProjectConversation,
    getOrCreateDirectConversation,
    conversationTargets,
    sendMessage,
    listMessages,
    editMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    markRead,
    unreadCount,
    listConversations,
    removeProjectParticipant,
    assertCanPost,
    canAccess,
    canUserAccessConversation,
  };
}

export type MessageService = ReturnType<typeof createMessageService>;
