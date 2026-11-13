import { ForbiddenError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { COMPANY_WORDS, dmReadOnlyMessage } from '../companies/company-rules';
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
  ChatPerson,
} from './chat-repository';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { safeUploadName } from '../../lib/upload-safety';
import { removeStoredFile } from '../../lib/stored-files';

const ATTACHMENT_URL_PREFIX = '/uploads';
type AttachmentView = MessageAttachmentRecord & { url: string };

/** Longest message body (after trimming) — the same limit applies to attachment captions. */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Review fix #17: a pair of people's key — "<smaller id>:<larger id>", the ids compared byte by byte (as the
 * backfill migration compares them), so whichever of the two starts the chat names the same conversation.
 */
export function directKeyOf(userA: string, userB: string): string {
  return Buffer.compare(Buffer.from(userA, 'utf8'), Buffer.from(userB, 'utf8')) <= 0 ? `${userA}:${userB}` : `${userB}:${userA}`;
}

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

/** A short quote of the message being answered (no text once that message is deleted). */
export interface ReplyQuote {
  id: string;
  userId: string;
  body: string;
  deleted: boolean;
}

/** A message enriched with its grouped reactions + attachments, as returned to clients. */
export interface MessageView extends Message {
  reactions: ReactionGroup[];
  attachments: AttachmentView[];
  replyTo: ReplyQuote | null;
}

/** What everyone may know about a participant (their personal settings stay private). */
export type PublicParticipant = Pick<Participant, 'conversationId' | 'userId' | 'lastReadAt' | 'addedAt'> & { lastDeliveredAt: Date | null };

export interface ConversationPrefs {
  favorite: boolean;
  archived: boolean;
  muted: boolean;
}

/**
 * companies: a direct chat with someone the person no longer shares a company with stays readable but
 * can't be written in; this says why ("You no longer share a company with Sara."). null: writable.
 */
export type ReadOnlyNote = { message: string } | null;

export interface ConversationSummary {
  conversation: Conversation;
  participants: PublicParticipant[];
  unread: number;
  lastMessage: Message | null;
  /** The signed-in person's own settings for this conversation. */
  prefs: ConversationPrefs;
  /** companies: why it can't be written in, or null. */
  readOnly: ReadOnlyNote;
}

/** Someone who wrote (or is quoted) on a page of messages — their name shows even when the reader doesn't otherwise know them. */
export interface MessageAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** A page of messages, oldest first, and everyone who wrote them. */
export interface MessagesPage {
  messages: MessageView[];
  authors: MessageAuthor[];
}

/** What to send: text (may be empty with a file), an optional file, reply and retry id. */
export interface PostMessageInput {
  body: string;
  attachment?: StoredFileMeta;
  replyToId?: string | null;
  clientId?: string | null;
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
  /** Fired when someone reads a conversation (used to clear the notifications about it). */
  onRead?: (e: { conversationId: string; userId: string }) => void | Promise<void>;
  /** Where failed (best-effort) notification hooks, and files that couldn't be deleted, are reported. */
  logger?: Pick<Logger, 'error'> & Partial<Pick<Logger, 'warn'>>;
}

const DEFAULT_LIMIT = 50;
/** Longest quote of a replied-to message. */
const QUOTE_LENGTH = 200;
/** Shortest search, and most results. */
const SEARCH_MIN = 2;
const SEARCH_LIMIT = 50;

const publicParticipant = (p: Participant): PublicParticipant => ({
  conversationId: p.conversationId,
  userId: p.userId,
  lastReadAt: p.lastReadAt,
  addedAt: p.addedAt,
  lastDeliveredAt: p.lastDeliveredAt ?? null,
});
const prefsOf = (p: Participant | null): ConversationPrefs => ({ favorite: !!p?.favorite, archived: !!p?.archivedAt, muted: !!p?.mutedAt });
const fullName = (p: ChatPerson) => `${p.firstName} ${p.lastName}`.trim() || p.username;
const firstName = (p: ChatPerson) => p.firstName.trim() || p.username;
const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === 'P2002' || /unique constraint/i.test(String((err as Error)?.message ?? ''));

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

  /**
   * companies: a direct chat is read-only for this person when someone else in it shares no active
   * company with them (neither being an administrator). `others` are the people in it.
   */
  async function readOnlyAmong(conv: Conversation, userId: string, others: string[]): Promise<ReadOnlyNote> {
    if (conv.kind !== 'DIRECT' || !members.colleagues) return null;
    for (const other of others) {
      if (other === userId || (await members.colleagues(userId, other))) continue;
      const [person] = members.people ? await members.people([other]) : [];
      return { message: dmReadOnlyMessage(person ? firstName(person) : 'this person') };
    }
    return null;
  }
  async function readOnlyOf(conv: Conversation, userId: string): Promise<ReadOnlyNote> {
    if (conv.kind !== 'DIRECT' || !members.colleagues) return null;
    return readOnlyAmong(conv, userId, (await participants.listByConversation(conv.id)).map((p) => p.userId));
  }
  /** Refuses (403 DM_READ_ONLY) sending, attaching, reacting and editing in a read-only direct chat. */
  async function assertCanWrite(conv: Conversation, userId: string): Promise<void> {
    const note = await readOnlyOf(conv, userId);
    if (note) throw new HttpError(note.message, 'DM_READ_ONLY', 403);
  }
  /** May this person write in this conversation they can open? Project channels: always. */
  async function canWriteDirect(conversationId: string, userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    const note = await readOnlyOf(conv, userId);
    return note ? { ok: false, message: note.message } : { ok: true };
  }

  /** Can this user read the conversation right now? (Used to filter mention recipients.) */
  async function canUserAccessConversation(conversationId: string, userId: string): Promise<boolean> {
    const conv = await conversations.findById(conversationId);
    return conv ? canAccess(conv, userId) : false;
  }

  /** Throws unless the user may post to the conversation — checked before an upload is stored. */
  async function assertCanPost(conversationId: string, userId: string): Promise<void> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    await assertCanWrite(conv, userId);
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
    const conv = (await conversations.findProjectConversation(projectId)) ?? (await createChannel(projectId));
    // Lazily record a participant row so read-state (lastReadAt) has somewhere to live.
    await participants.add(conv.id, userId);
    return conv;
  }

  /** N10: two people opening a new project's chat at once — whoever made it second gets the first one's. */
  async function createChannel(projectId: string): Promise<Conversation> {
    try {
      return await conversations.createProject(projectId);
    } catch (err) {
      const made = isUniqueViolation(err) ? await conversations.findProjectConversation(projectId) : null;
      if (made) return made;
      throw err;
    }
  }

  /**
   * The direct chat with someone: the existing one (perhaps read-only now), or a new one — only with a
   * colleague (companies: someone who shares a company with you; 403 NOT_A_COLLEAGUE otherwise).
   */
  async function getOrCreateDirectConversation(userId: string, otherUserId: string): Promise<Conversation & { readOnly: ReadOnlyNote }> {
    if (userId === otherUserId) throw new ValidationError('You cannot start a conversation with yourself.');
    const key = directKeyOf(userId, otherUserId);
    const existing = await findDirect(key, userId, otherUserId);
    if (existing) return { ...existing, readOnly: await readOnlyOf(existing, userId) };
    if (!(await members.isActiveUser(otherUserId))) throw new NotFoundError('User not found.');
    if (members.colleagues && !(await members.colleagues(userId, otherUserId))) throw new HttpError(COMPANY_WORDS.notColleague, 'NOT_A_COLLEAGUE', 403);
    if (conversations.createDirectPair) {
      // Review fix #17: the conversation and both people in one write, under the pair's unique key — the other
      // person (or a second click) starting it at the same moment gets this very conversation.
      try {
        return { ...(await conversations.createDirectPair(key, userId, otherUserId)), readOnly: null };
      } catch (err) {
        const made = isUniqueViolation(err) ? await findDirect(key, userId, otherUserId) : null;
        if (made) return { ...made, readOnly: await readOnlyOf(made, userId) };
        throw err;
      }
    }
    const conv = await conversations.createDirect();
    await participants.add(conv.id, userId);
    await participants.add(conv.id, otherUserId);
    return { ...conv, readOnly: null };
  }

  /**
   * The pair's conversation: the one with their key; else one made before keys that the backfill left without
   * one (the oldest they are both in), which takes the key now when no other conversation holds it.
   */
  async function findDirect(key: string, userId: string, otherUserId: string): Promise<Conversation | null> {
    const keyed = conversations.findDirectByKey ? await conversations.findDirectByKey(key) : null;
    if (keyed) return keyed;
    const older = await conversations.findDirectConversation(userId, otherUserId);
    if (older && conversations.stampDirectKey) await conversations.stampDirectKey(older.id, key);
    return older;
  }

  /**
   * Post a message. A retry that carries the same `clientId` as an earlier send gets that message
   * back (`created: false`) instead of a duplicate — also when two retries race each other.
   */
  async function postMessage(
    conversationId: string,
    userId: string,
    input: PostMessageInput,
  ): Promise<{ message: MessageView; created: boolean }> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    const clientId = input.clientId?.trim() || null;
    // N6: a file's name as kept and shown — no hidden or right-to-left characters, it fits its column, never empty.
    const attachment = input.attachment ? { ...input.attachment, fileName: safeUploadName(input.attachment.fileName, input.attachment.mimeType) } : undefined;
    const already = async () => (clientId && messages.findByClientId ? messages.findByClientId(conversationId, userId, clientId) : null);
    const earlier = await already();
    // A retry gets the first message back (#18: with its file — the two are saved together), never a second one.
    if (earlier) return { message: (await viewOf([earlier]))[0]!, created: false };
    await assertCanWrite(conv, userId);
    // A caption may be empty when a file is attached; a plain message may not.
    const text = cleanBody(input.body, !!attachment);
    let replyToId: string | null = null;
    let parent: Message | null = null;
    if (input.replyToId) {
      parent = await messages.findById(input.replyToId);
      if (!parent || parent.conversationId !== conversationId || parent.deletedAt) throw new ValidationError('You can only reply to a message in this conversation.');
      replyToId = parent.id;
    }
    let message: Message;
    /** Review I1: the saved message as its answer shows it, made from what was saved — no read after the save. */
    let savedView: MessageView | null = null;
    try {
      if (attachment && deps.attachments && messages.createWithAttachment) {
        // Review fix #18: the message and its file together, or neither.
        const saved = await messages.createWithAttachment(conversationId, userId, text, { replyToId, clientId }, attachment);
        message = saved.message;
        savedView = {
          ...message,
          reactions: [],
          attachments: [{ ...saved.attachment, url: `${ATTACHMENT_URL_PREFIX}/${saved.attachment.storageKey}` }],
          replyTo: parent ? { id: parent.id, userId: parent.userId, body: parent.body.slice(0, QUOTE_LENGTH), deleted: false } : null,
        };
      } else {
        message = await messages.create(conversationId, userId, text, { replyToId, clientId });
        if (attachment && deps.attachments) await deps.attachments.create(message.id, attachment);
      }
    } catch (err) {
      const raced = isUniqueViolation(err) ? await already() : null;
      if (raced) return { message: (await viewOf([raced]))[0]!, created: false };
      throw err;
    }

    const usernames = parseMentions(text);
    if (usernames.length > 0) {
      await bestEffort('mention', () => deps.onMention?.({ conversationId, message, authorId: userId, usernames }));
    }

    if (conv.kind === 'DIRECT') {
      // Someone who muted this conversation isn't told about each new message. Review I1: the message is saved —
      // nothing from here on may turn the send into a failure (a file's retry would find its message anyway).
      await bestEffort('direct message', async () => {
        const others = (await participants.listByConversation(conversationId)).filter((p) => p.userId !== userId && !p.mutedAt);
        for (const p of others) {
          await bestEffort('direct message', () => deps.onDirectMessage?.({ conversationId, message, authorId: userId, recipientId: p.userId }));
        }
      });
    }
    return { message: savedView ?? (await viewOf([message]))[0]!, created: true };
  }

  /**
   * Review I1: does a saved file record use this stored file? The upload route asks before removing a file after
   * a failure — on any doubt (this read failing too) the file is kept.
   */
  async function fileInUse(storageKey: string): Promise<boolean> {
    return deps.attachments?.storageKeyInUse ? deps.attachments.storageKeyInUse(storageKey) : false;
  }

  /** The message this sender already posted with this client id (a retry), or null. */
  async function findSent(conversationId: string, userId: string, clientId: string): Promise<MessageView | null> {
    await assertAccess(await load(conversationId), userId);
    const m = messages.findByClientId ? await messages.findByClientId(conversationId, userId, clientId) : null;
    return m ? (await viewOf([m]))[0]! : null;
  }

  async function sendMessage(conversationId: string, userId: string, body: string, attachment?: StoredFileMeta): Promise<Message> {
    return (await postMessage(conversationId, userId, { body, attachment })).message;
  }

  /** Messages as clients see them: reactions grouped, files listed, replies quoted, deleted ones emptied. */
  async function viewOf(ordered: Message[]): Promise<MessageView[]> {
    const ids = ordered.filter((m) => !m.deletedAt).map((m) => m.id);
    const rows = ids.length ? await reactions.listByMessages(ids) : [];
    const byMessage = new Map<string, Map<string, string[]>>();
    for (const r of rows) {
      const emojis = byMessage.get(r.messageId) ?? new Map<string, string[]>();
      const users = emojis.get(r.emoji) ?? [];
      users.push(r.userId);
      emojis.set(r.emoji, users);
      byMessage.set(r.messageId, emojis);
    }
    const attachmentRows = deps.attachments && ids.length ? await deps.attachments.listByMessages(ids) : [];
    const attByMessage = new Map<string, AttachmentView[]>();
    for (const a of attachmentRows) {
      const list = attByMessage.get(a.messageId) ?? [];
      list.push({ ...a, url: `${ATTACHMENT_URL_PREFIX}/${a.storageKey}` });
      attByMessage.set(a.messageId, list);
    }
    const parentIds = [...new Set(ordered.map((m) => m.replyToId).filter((x): x is string => !!x))];
    const parents = new Map<string, Message>();
    for (const pid of parentIds) {
      const p = ordered.find((m) => m.id === pid) ?? (await messages.findById(pid));
      if (p) parents.set(pid, p);
    }
    const quote = (pid: string | null | undefined): ReplyQuote | null => {
      const p = pid ? parents.get(pid) : undefined;
      if (!p) return null;
      return { id: p.id, userId: p.userId, body: p.deletedAt ? '' : p.body.slice(0, QUOTE_LENGTH), deleted: !!p.deletedAt };
    };
    // Deleted messages come back as tombstones: deletedAt set, no text, reactions or files.
    return ordered.map<MessageView>((m) => ({
      ...redact(m),
      reactions: m.deletedAt ? [] : [...(byMessage.get(m.id)?.entries() ?? [])].map(([emoji, userIds]) => ({ emoji, userIds })),
      attachments: m.deletedAt ? [] : attByMessage.get(m.id) ?? [],
      replyTo: quote(m.replyToId),
    }));
  }

  /** Everyone who wrote a message on the page or is quoted by a reply on it, in order of appearance. */
  async function authorsOf(page: MessageView[]): Promise<MessageAuthor[]> {
    if (!members.people) return [];
    const ids = [...new Set(page.flatMap((m) => [m.userId, ...(m.replyTo ? [m.replyTo.userId] : [])]))];
    if (ids.length === 0) return [];
    const byId = new Map((await members.people(ids)).map((p) => [p.id, p]));
    return ids.flatMap((id) => {
      const p = byId.get(id);
      return p ? [{ id, name: fullName(p), avatarUrl: p.avatarUrl }] : [];
    });
  }

  /**
   * A page of history. `before` alone (the old cursor, still sent by the Android app and the extension): the
   * messages strictly older than that moment, as before. With `beforeId` too (review fix #20): older than that
   * message, by time then id — a message of the same millisecond is never skipped.
   */
  async function listMessages(conversationId: string, userId: string, opts?: { before?: Date; beforeId?: string; limit?: number }): Promise<MessagesPage> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    const page = await messages.list(conversationId, {
      before: opts?.before,
      ...(opts?.before && opts.beforeId ? { beforeId: opts.beforeId } : {}),
      limit: opts?.limit ?? DEFAULT_LIMIT,
    });
    const ordered = [...page].reverse(); // repo returns newest-first; display oldest-first
    const view = await viewOf(ordered);
    return { messages: view, authors: await authorsOf(view) };
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
    await assertCanWrite(conv, userId);
    const text = cleanBody(body, false);
    return messages.update(messageId, text);
  }

  async function deleteMessage(messageId: string, userId: string, canModerate: boolean): Promise<Message> {
    const { message: m, conv } = await messageConversation(messageId);
    if (m.userId !== userId && !canModerate) throw new ForbiddenError('You can only delete your own message.');
    if (!canModerate) await assertAccess(conv, userId);
    // Purge attachment files + rows so a deleted message leaves nothing downloadable on the server. Review fix
    // #23: the message is emptied and its files' rows go first, then the files themselves — nothing ever points
    // at a missing file, and a file the disk won't delete is tried again, then logged (never quietly left).
    const atts = deps.attachments ? await deps.attachments.listByMessages([messageId]) : [];
    const deleted = await messages.softDelete(messageId);
    if (deps.attachments && atts.length > 0) {
      await deps.attachments.deleteByMessage(messageId);
      const storage = deps.storage;
      if (storage) for (const a of atts) await removeStoredFile(storage, a.storageKey, { logger: fileLog, what: 'a deleted chat message’s file' });
    }
    return redact(deleted);
  }

  /** Where a file that couldn't be deleted is reported. */
  const fileLog = { warn: (message: string, context?: Record<string, unknown>) => (deps.logger?.warn ?? deps.logger?.error ?? console.warn)(message, context) };

  async function addReaction(messageId: string, userId: string, emoji: string): Promise<{ conversationId: string }> {
    const { message, conv } = await messageConversation(messageId);
    await assertAccess(conv, userId);
    await assertCanWrite(conv, userId);
    if (message.deletedAt) throw new ValidationError('You cannot react to a deleted message.');
    await reactions.add(messageId, userId, emoji);
    return { conversationId: message.conversationId };
  }
  async function removeReaction(messageId: string, userId: string, emoji: string): Promise<{ conversationId: string }> {
    const { message, conv } = await messageConversation(messageId);
    await assertAccess(conv, userId);
    await assertCanWrite(conv, userId);
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
    await bestEffort('read', () => deps.onRead?.({ conversationId, userId }));
  }

  /**
   * Unread messages for this person: a direct message counts everything after they last read it;
   * a project channel counts only for the project's team — from when they last read it or, never
   * opened, from when they joined the team (an administrator's view of other projects never counts).
   */
  /**
   * Unread messages count from here (null: every one); undefined: none count — a channel of a project
   * the person isn't on the team of (an administrator's access to every project).
   */
  function unreadFrom(conv: Conversation, lastReadAt: Date | null, team: Map<string, Date> | null): Date | null | undefined {
    if (conv.kind === 'PROJECT' && team) {
      const since = conv.projectId ? team.get(conv.projectId) : undefined;
      return since ? (lastReadAt ?? since) : undefined;
    }
    return lastReadAt;
  }
  async function unreadFor(conv: Conversation, userId: string, lastReadAt: Date | null, team: Map<string, Date> | null): Promise<number> {
    const after = unreadFrom(conv, lastReadAt, team);
    return after === undefined ? 0 : messages.countAfter(conv.id, after, userId);
  }

  async function unreadCount(conversationId: string, userId: string): Promise<number> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    const p = await participants.find(conversationId, userId);
    const team = conv.kind === 'PROJECT' && members.teamSince ? await members.teamSince(userId) : null;
    return unreadFor(conv, userId, p?.lastReadAt ?? null, team);
  }

  /** companies: `onlyProjectIds` (a picked company's projects) keeps only those projects' channels. */
  const keepOnly = (ids: string[], only?: readonly string[] | null) => (only ? ids.filter((id) => only.includes(id)) : ids);

  async function listConversations(userId: string, opts?: { onlyProjectIds?: readonly string[] | null }): Promise<ConversationSummary[]> {
    // DMs come from participant rows; project channels from the projects the user can see NOW —
    // a stale participant row from a project they've left grants nothing. With a picked company
    // (companies), only its projects' channels; direct chats are always kept.
    const [participantConvs, projectConvs, team] = await Promise.all([
      participants.listConversationIdsForUser(userId).then((ids) => conversations.listByIds(ids)),
      members.accessibleProjectIds(userId).then((ids) => conversations.listProjectConversations(keepOnly(ids, opts?.onlyProjectIds))),
      members.teamSince ? members.teamSince(userId) : Promise.resolve(null),
    ]);
    const byId = new Map<string, Conversation>();
    for (const c of participantConvs) if (c.kind === 'DIRECT') byId.set(c.id, c);
    for (const c of projectConvs) byId.set(c.id, c);
    // Review #35: a few reads for the whole list when the stores can (the Prisma ones); one conversation at a time otherwise.
    const batched = participants.listByConversations && messages.latestMany && messages.countAfterMany;
    const summaries = batched ? await summariesAtOnce([...byId.values()], userId, team) : await Promise.all(
      [...byId.values()].map(async (conversation) => {
        const p = await participants.find(conversation.id, userId);
        const latest = await messages.latest(conversation.id);
        const people = await participants.listByConversation(conversation.id);
        return {
          conversation,
          participants: people.map(publicParticipant),
          unread: await unreadFor(conversation, userId, p?.lastReadAt ?? null, team),
          lastMessage: latest ? redact(latest) : null,
          prefs: prefsOf(p),
          readOnly: await readOnlyAmong(conversation, userId, people.map((x) => x.userId)),
        };
      }),
    );
    // Most recently active first.
    return summaries.sort(
      (a, b) => (b.lastMessage?.createdAt.getTime() ?? 0) - (a.lastMessage?.createdAt.getTime() ?? 0),
    );
  }

  /**
   * Review #35: the conversation list's summaries in a few reads, however many conversations there are —
   * the very answer the one-at-a-time reads give (its participants in the same order, the same unread
   * counts, last messages, settings and read-only notes).
   */
  async function summariesAtOnce(list: Conversation[], userId: string, team: Map<string, Date> | null): Promise<ConversationSummary[]> {
    const ids = list.map((c) => c.id);
    const [rows, latest] = await Promise.all([participants.listByConversations!(ids), messages.latestMany!(ids)]);
    const people = new Map<string, Participant[]>();
    for (const r of rows) people.set(r.conversationId, [...(people.get(r.conversationId) ?? []), r]);
    const mine = new Map(rows.filter((r) => r.userId === userId).map((r) => [r.conversationId, r]));
    const asks = list.flatMap((c) => {
      const after = unreadFrom(c, mine.get(c.id)?.lastReadAt ?? null, team);
      return after === undefined ? [] : [{ conversationId: c.id, after }];
    });
    const [unread, readOnly] = await Promise.all([
      asks.length ? messages.countAfterMany!(asks, userId) : Promise.resolve(new Map<string, number>()),
      readOnlyAll(list, userId, people),
    ]);
    return list.map((conversation) => {
      const latestOne = latest.get(conversation.id);
      return {
        conversation,
        participants: (people.get(conversation.id) ?? []).map(publicParticipant),
        unread: unread.get(conversation.id) ?? 0,
        lastMessage: latestOne ? redact(latestOne) : null,
        prefs: prefsOf(mine.get(conversation.id) ?? null),
        readOnly: readOnly.get(conversation.id) ?? null,
      };
    });
  }

  /** readOnlyAmong for every direct chat of a list: who of the others are colleagues, and the names, each read once. */
  async function readOnlyAll(list: Conversation[], userId: string, people: Map<string, Participant[]>): Promise<Map<string, ReadOnlyNote>> {
    const out = new Map<string, ReadOnlyNote>();
    const direct = list.filter((c) => c.kind === 'DIRECT');
    if (!members.colleagues || direct.length === 0) return out;
    const everyoneIn = (c: Conversation) => (people.get(c.id) ?? []).map((p) => p.userId);
    if (!members.colleaguesAmong) {
      for (const c of direct) out.set(c.id, await readOnlyAmong(c, userId, everyoneIn(c)));
      return out;
    }
    const colleagues = await members.colleaguesAmong(userId, [...new Set(direct.flatMap(everyoneIn))].filter((id) => id !== userId));
    // As readOnlyAmong: the first other person in it who isn't a colleague names the note.
    const stranger = new Map<string, string>();
    for (const c of direct) {
      const other = everyoneIn(c).find((id) => id !== userId && !colleagues.has(id));
      if (other) stranger.set(c.id, other);
    }
    if (stranger.size === 0) return out;
    const named = new Map((members.people ? await members.people([...new Set(stranger.values())]) : []).map((p) => [p.id, p]));
    for (const [conversationId, other] of stranger) {
      const person = named.get(other);
      out.set(conversationId, { message: dmReadOnlyMessage(person ? firstName(person) : 'this person') });
    }
    return out;
  }

  /** Favorite, archive or mute a conversation — for this person only. */
  async function setPreferences(conversationId: string, userId: string, patch: Partial<ConversationPrefs>): Promise<ConversationPrefs> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    if (!participants.setPrefs) throw new ValidationError('Conversation settings are not available.');
    await participants.add(conversationId, userId); // a channel's row is created lazily
    const now = new Date();
    const row = await participants.setPrefs(conversationId, userId, {
      ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? now : null } : {}),
      ...(patch.muted !== undefined ? { mutedAt: patch.muted ? now : null } : {}),
    });
    return prefsOf(row);
  }

  /** This person's app has received the conversation's messages so far ("delivered"). */
  async function markDelivered(conversationId: string, userId: string): Promise<void> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    if (!participants.setLastDelivered) return;
    await participants.add(conversationId, userId);
    await participants.setLastDelivered(conversationId, userId, new Date());
  }

  /** Conversations this person can open right now (DMs they're in + channels of projects they see). */
  async function accessibleConversationIds(userId: string, onlyProjectIds?: readonly string[] | null): Promise<string[]> {
    const [participantConvs, projectConvs] = await Promise.all([
      participants.listConversationIdsForUser(userId).then((ids) => conversations.listByIds(ids)),
      members.accessibleProjectIds(userId).then((ids) => conversations.listProjectConversations(keepOnly(ids, onlyProjectIds))),
    ]);
    return [...new Set([...participantConvs.filter((c) => c.kind === 'DIRECT'), ...projectConvs].map((c) => c.id))];
  }

  /** Messages containing the words, in one conversation or in all of this person's conversations. */
  async function searchMessages(userId: string, q: string, opts?: { conversationId?: string; limit?: number; onlyProjectIds?: readonly string[] | null }): Promise<Message[]> {
    const text = q.trim();
    if (opts?.conversationId) await assertAccess(await load(opts.conversationId), userId);
    if (text.length < SEARCH_MIN || !messages.search) return [];
    const ids = opts?.conversationId ? [opts.conversationId] : await accessibleConversationIds(userId, opts?.onlyProjectIds);
    if (ids.length === 0) return [];
    return messages.search(ids, text, Math.min(opts?.limit ?? SEARCH_LIMIT, SEARCH_LIMIT));
  }

  /** Who is in a conversation: a channel's project people, or the people in a direct conversation. */
  async function listMembers(conversationId: string, userId: string): Promise<string[]> {
    const conv = await load(conversationId);
    await assertAccess(conv, userId);
    if (conv.kind === 'PROJECT' && conv.projectId && members.projectMemberIds) return members.projectMemberIds(conv.projectId);
    return (await participants.listByConversation(conversationId)).map((p) => p.userId);
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
    canWriteDirect,
    conversationTargets,
    sendMessage,
    postMessage,
    findSent,
    fileInUse,
    setPreferences,
    markDelivered,
    searchMessages,
    accessibleConversationIds,
    listMembers,
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
