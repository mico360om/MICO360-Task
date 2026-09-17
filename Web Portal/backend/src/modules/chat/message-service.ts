import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
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

/** Extract unique @usernames from a message body (for mention notifications). */
export function parseMentions(body: string): string[] {
  const matches = body.match(/@([a-zA-Z0-9_]+)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1)))];
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
}

const DEFAULT_LIMIT = 50;

export function createMessageService(deps: MessageServiceDeps) {
  const { conversations, participants, messages, reactions, members } = deps;

  async function load(conversationId: string): Promise<Conversation> {
    const c = await conversations.findById(conversationId);
    if (!c) throw new NotFoundError('Conversation not found.');
    return c;
  }

  /** A user may access a PROJECT conversation if they're a project member, a DIRECT one if a participant. */
  async function canAccess(conv: Conversation, userId: string): Promise<boolean> {
    if (conv.kind === 'PROJECT') return conv.projectId ? members.isProjectMember(conv.projectId, userId) : false;
    return (await participants.find(conv.id, userId)) !== null;
  }
  async function assertAccess(conv: Conversation, userId: string): Promise<void> {
    if (!(await canAccess(conv, userId))) throw new ForbiddenError('You do not have access to this conversation.');
  }

  async function getOrCreateProjectConversation(projectId: string, userId: string): Promise<Conversation> {
    if (!(await members.isProjectMember(projectId, userId))) {
      throw new ForbiddenError('You are not a member of this project.');
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
    const message = await messages.create(conversationId, userId, body);
    if (attachment && deps.attachments) await deps.attachments.create(message.id, attachment);

    const usernames = parseMentions(body);
    if (usernames.length > 0) await deps.onMention?.({ conversationId, message, authorId: userId, usernames });

    if (conv.kind === 'DIRECT') {
      const others = (await participants.listByConversation(conversationId)).filter((p) => p.userId !== userId);
      for (const p of others) {
        await deps.onDirectMessage?.({ conversationId, message, authorId: userId, recipientId: p.userId });
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
    const ids = ordered.map((m) => m.id);
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
    const view = ordered.map<MessageView>((m) => ({
      ...m,
      reactions: [...(byMessage.get(m.id)?.entries() ?? [])].map(([emoji, userIds]) => ({ emoji, userIds })),
      attachments: attByMessage.get(m.id) ?? [],
    }));
    return { messages: view };
  }

  async function editMessage(messageId: string, userId: string, body: string): Promise<Message> {
    const m = await messages.findById(messageId);
    if (!m) throw new NotFoundError('Message not found.');
    if (m.deletedAt) throw new ValidationError('You cannot edit a deleted message.');
    if (m.userId !== userId) throw new ForbiddenError('You can only edit your own message.');
    return messages.update(messageId, body);
  }

  async function deleteMessage(messageId: string, userId: string, canModerate: boolean): Promise<Message> {
    const m = await messages.findById(messageId);
    if (!m) throw new NotFoundError('Message not found.');
    if (m.userId !== userId && !canModerate) throw new ForbiddenError('You can only delete your own message.');
    // Purge attachment files + rows so a deleted message leaves nothing downloadable on the server.
    if (deps.attachments) {
      const atts = await deps.attachments.listByMessages([messageId]);
      if (deps.storage) for (const a of atts) await deps.storage.remove(a.storageKey).catch(() => {});
      await deps.attachments.deleteByMessage(messageId);
    }
    return messages.softDelete(messageId);
  }

  async function messageConversation(messageId: string): Promise<{ message: Message; conv: Conversation }> {
    const message = await messages.findById(messageId);
    if (!message) throw new NotFoundError('Message not found.');
    const conv = await load(message.conversationId);
    return { message, conv };
  }

  async function addReaction(messageId: string, userId: string, emoji: string): Promise<{ conversationId: string }> {
    const { message, conv } = await messageConversation(messageId);
    await assertAccess(conv, userId);
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
    const ids = new Set(await participants.listConversationIdsForUser(userId));
    // Include every project channel the user can access, even those not yet opened.
    for (const pid of await members.projectIdsForUser(userId)) {
      const pc = await conversations.findProjectConversation(pid);
      if (pc) ids.add(pc.id);
    }
    const convs = await conversations.listByIds([...ids]);
    const summaries = await Promise.all(
      convs.map(async (conversation) => {
        const p = await participants.find(conversation.id, userId);
        return {
          conversation,
          participants: await participants.listByConversation(conversation.id),
          unread: await messages.countAfter(conversation.id, p?.lastReadAt ?? null, userId),
          lastMessage: await messages.latest(conversation.id),
        };
      }),
    );
    // Most recently active first.
    return summaries.sort(
      (a, b) => (b.lastMessage?.createdAt.getTime() ?? 0) - (a.lastMessage?.createdAt.getTime() ?? 0),
    );
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
    canAccess,
  };
}

export type MessageService = ReturnType<typeof createMessageService>;
