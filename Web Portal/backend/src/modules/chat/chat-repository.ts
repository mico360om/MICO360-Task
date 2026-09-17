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
  listByIds(ids: string[]): Promise<Conversation[]>;
}

export interface ParticipantRepository {
  add(conversationId: string, userId: string): Promise<Participant>;
  find(conversationId: string, userId: string): Promise<Participant | null>;
  listByConversation(conversationId: string): Promise<Participant[]>;
  /** Conversation ids the user is an explicit participant of (DIRECT conversations). */
  listConversationIdsForUser(userId: string): Promise<string[]>;
  /** Upsert the user's read marker for a conversation. */
  setLastRead(conversationId: string, userId: string, at: Date): Promise<void>;
}

export interface MessageListOptions {
  /** Return messages created strictly before this instant (keyset pagination for older history). */
  before?: Date;
  limit: number;
}

export interface MessageRepository {
  create(conversationId: string, userId: string, body: string): Promise<Message>;
  findById(id: string): Promise<Message | null>;
  /** Newest-first page of a conversation's messages (callers reverse for display). */
  list(conversationId: string, opts: MessageListOptions): Promise<Message[]>;
  update(id: string, body: string): Promise<Message>;
  softDelete(id: string): Promise<Message>;
  /** Count messages after `after` (null = all) excluding those authored by `excludeUserId`. */
  countAfter(conversationId: string, after: Date | null, excludeUserId: string): Promise<number>;
  latest(conversationId: string): Promise<Message | null>;
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
}

/** Facts about project membership the chat service needs but doesn't own. */
export interface ChatMemberLookup {
  isProjectMember(projectId: string, userId: string): Promise<boolean>;
  /** Project ids the user belongs to (for building the conversation inbox). */
  projectIdsForUser(userId: string): Promise<string[]>;
}
