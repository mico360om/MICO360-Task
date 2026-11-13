/**
 * Chat domain records + repository ports (M-chat).
 *
 * A single Conversation abstraction backs both a project's team channel (kind PROJECT,
 * one per project) and a 1:1 direct message (kind DIRECT, one per user-pair). Messages,
 * reactions, attachments and read-state are uniform across both kinds.
 */

export type ConversationKind = 'PROJECT' | 'DIRECT';

export interface Conversation {
  id: string;
  kind: ConversationKind;
  /** Set for PROJECT conversations; null for DIRECT. */
  projectId: string | null;
  createdAt: Date;
}

export interface Participant {
  conversationId: string;
  userId: string;
  /** Last time the user read this conversation; null = never read (everything is unread). */
  lastReadAt: Date | null;
  addedAt: Date;
  /** Personal settings (never shown to the other people in the conversation). */
  favorite?: boolean;
  archivedAt?: Date | null;
  mutedAt?: Date | null;
  /** Last time this person's app received the conversation's messages ("delivered"). */
  lastDeliveredAt?: Date | null;
}

/** A person's own settings for one conversation. */
export interface ParticipantPrefsPatch {
  favorite?: boolean;
  archivedAt?: Date | null;
  mutedAt?: Date | null;
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  body: string;
  editedAt: Date | null;
  /** Soft-delete tombstone; a deleted message keeps its row so history stays intact. */
  deletedAt: Date | null;
  createdAt: Date;
  /** The message this one answers (same conversation). */
  replyToId?: string | null;
  /** The sender's own id for this message, so a retried send is recognised (unique per sender). */
  clientId?: string | null;
}

export interface Reaction {
  messageId: string;
  userId: string;
  emoji: string;
}

export interface MessageAttachmentRecord {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
}

export interface ConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  findProjectConversation(projectId: string): Promise<Conversation | null>;
  /** The DIRECT conversation between two users, regardless of argument order. */
  findDirectConversation(userA: string, userB: string): Promise<Conversation | null>;
  createProject(projectId: string): Promise<Conversation>;
  createDirect(): Promise<Conversation>;
  /** Review fix #17: the DIRECT conversation that carries this pair key (directKeyOf), or null. */
  findDirectByKey?(key: string): Promise<Conversation | null>;
  /**
   * Review fix #17: a new DIRECT conversation with its pair key and both people in it, in one write.
   * Rejects with a unique-constraint error when the pair already has its conversation.
   */
  createDirectPair?(key: string, userA: string, userB: string): Promise<Conversation>;
  /** Review fix #17: give a conversation made before pair keys its key — only while it has none and no other holds it. */
  stampDirectKey?(id: string, key: string): Promise<boolean>;
  listByIds(ids: string[]): Promise<Conversation[]>;
  /** The channels of these projects (those that have been opened at least once). */
  listProjectConversations(projectIds: string[]): Promise<Conversation[]>;
}

export interface ParticipantRepository {
  add(conversationId: string, userId: string): Promise<Participant>;
  /** Drop a user's participant row (e.g. after they leave the channel's project). */
  remove(conversationId: string, userId: string): Promise<void>;
  find(conversationId: string, userId: string): Promise<Participant | null>;
  listByConversation(conversationId: string): Promise<Participant[]>;
  /**
   * Review #35: every participant row of these conversations in one read, each conversation's rows in
   * listByConversation's order (the conversation list). Absent: one read per conversation.
   */
  listByConversations?(conversationIds: string[]): Promise<Participant[]>;
  /** Conversation ids the user is an explicit participant of (DIRECT conversations). */
  listConversationIdsForUser(userId: string): Promise<string[]>;
  /** Upsert the user's read marker for a conversation. */
  setLastRead(conversationId: string, userId: string, at: Date): Promise<void>;
  /** Change a participant's own settings (the row must exist). */
  setPrefs?(conversationId: string, userId: string, patch: ParticipantPrefsPatch): Promise<Participant>;
  /** Move the delivered marker forward (never back). */
  setLastDelivered?(conversationId: string, userId: string, at: Date): Promise<void>;
}

export interface MessageListOptions {
  /** Return messages created strictly before this instant (keyset pagination for older history). */
  before?: Date;
  /**
   * Review fix #20: with `before`, the cursor is that message (its time and id): the page also holds the
   * messages of that same moment that come before it, so a tie on a page boundary is never skipped.
   */
  beforeId?: string;
  limit: number;
}

export interface MessageRepository {
  /** Rejects with a unique-constraint error when the sender already used this clientId here. */
  create(conversationId: string, userId: string, body: string, extra?: { replyToId?: string | null; clientId?: string | null }): Promise<Message>;
  /**
   * Review fix #18: a message and its file in one transaction — both are saved, or neither is. Rejects with a
   * unique-constraint error, saving nothing, when the sender already used this clientId here.
   */
  createWithAttachment?(
    conversationId: string,
    userId: string,
    body: string,
    extra: { replyToId?: string | null; clientId?: string | null },
    file: StoredFileMeta,
  ): Promise<{ message: Message; attachment: MessageAttachmentRecord }>;
  findByClientId?(conversationId: string, userId: string, clientId: string): Promise<Message | null>;
  /** Live (not deleted) messages in these conversations whose text contains `q` (any case), newest first. */
  search?(conversationIds: string[], q: string, limit: number): Promise<Message[]>;
  findById(id: string): Promise<Message | null>;
  /** Newest-first page of a conversation's messages, by time then id (callers reverse for display). */
  list(conversationId: string, opts: MessageListOptions): Promise<Message[]>;
  update(id: string, body: string): Promise<Message>;
  /** Tombstone a message: stamp deletedAt and blank its body so the text can't be read back. */
  softDelete(id: string): Promise<Message>;
  /** Count messages after `after` (null = all) excluding those authored by `excludeUserId`. */
  countAfter(conversationId: string, after: Date | null, excludeUserId: string): Promise<number>;
  latest(conversationId: string): Promise<Message | null>;
  /** Review #35: `latest` of each of these conversations in one go (a conversation with no message is absent). */
  latestMany?(conversationIds: string[]): Promise<Map<string, Message>>;
  /** Review #35: `countAfter` of each conversation asked, in one go (every one asked is in the answer). */
  countAfterMany?(asks: { conversationId: string; after: Date | null }[], excludeUserId: string): Promise<Map<string, number>>;
}

export interface ReactionRepository {
  add(messageId: string, userId: string, emoji: string): Promise<void>;
  remove(messageId: string, userId: string, emoji: string): Promise<void>;
  listByMessages(messageIds: string[]): Promise<Reaction[]>;
}

/** Metadata for a stored file, ready to persist against a message. */
export interface StoredFileMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

export interface ChatAttachmentRepository {
  create(messageId: string, meta: StoredFileMeta): Promise<MessageAttachmentRecord>;
  listByMessages(messageIds: string[]): Promise<MessageAttachmentRecord[]>;
  /** Remove all attachment rows for a message (its files are removed via storage separately). */
  deleteByMessage(messageId: string): Promise<void>;
  /** Review I1: does any file record use this stored file? (Asked before a file is removed after a failed send.) */
  storageKeyInUse?(storageKey: string): Promise<boolean>;
}

/** A person as a page of messages names them. */
export interface ChatPerson {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  avatarUrl: string | null;
}

/**
 * Facts about project visibility and users the chat service needs but doesn't own. A project's
 * channel follows project visibility: its owner, manager, creator and members — and any admin.
 */
export interface ChatMemberLookup {
  /** May the user open this project's channel? False for deleted projects. */
  canAccessProject(projectId: string, userId: string): Promise<boolean>;
  /** Projects whose channel the user may open (for building the conversation inbox). */
  accessibleProjectIds(userId: string): Promise<string[]>;
  /** Is this an existing, active user — someone a DM can be started with? */
  isActiveUser(userId: string): Promise<boolean>;
  /** Everyone who can see a project's channel (owner, manager, creator, members). */
  projectMemberIds?(projectId: string): Promise<string[]>;
  /**
   * Since when the user has been on each project's team (owner, manager or member).
   * Unread counts use it: a channel they never opened counts from here, and a project they can
   * open without being on its team (an administrator) is absent and never counts as unread.
   */
  teamSince?(userId: string): Promise<Map<string, Date>>;
  /**
   * companies: do these two share an active company (always true when either is an administrator)?
   * A new direct chat needs it, and a direct chat without it is read-only. Absent: always true.
   */
  colleagues?(userId: string, otherId: string): Promise<boolean>;
  /** Review #35: which of these people are `colleagues` of this person, in one go. Absent: asked one by one. */
  colleaguesAmong?(userId: string, otherIds: string[]): Promise<Set<string>>;
  /** companies: names and pictures of these people (whatever their status), so every author on a page of messages has a name. */
  people?(userIds: string[]): Promise<ChatPerson[]>;
}
