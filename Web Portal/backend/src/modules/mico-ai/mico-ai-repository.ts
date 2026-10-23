import { randomUUID } from 'node:crypto';

/**
 * Where MICO AI keeps a person's chats. Every chat read and change takes the owner's id, so a chat
 * can only ever be found by the person it belongs to (admins included: they can't open anyone
 * else's). Deleting a chat deletes its messages for good. An answer's tool results (the data its
 * tables were copied from, kept so later questions can use them) are stored apart from the
 * answer, and only the paths that need them read them.
 */

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'PENDING' | 'DONE' | 'ERROR' | 'STOPPED';

export interface ChatRecord {
  id: string;
  userId: string;
  /** '' until the first question names it. */
  title: string;
  /** A short running summary of the turns older than the recent window. */
  summary: string | null;
  /** How many of the oldest messages the summary covers. */
  summarizedCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: MessageRole;
  /** The question, or the answer's plain words (search reads this). */
  text: string;
  /** The answer as JSON (AssistantContent without its results), or { error } for a failed one; null for a question. */
  content: unknown;
  status: MessageStatus;
  /** While PENDING: what MICO AI is doing ("Checking tasks in Rig Inspection…"). */
  step: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A message with the tool results kept with it (only the context of a new question reads these). */
export interface MessageWithResults extends MessageRecord {
  results: unknown;
}

export interface ChatMatch {
  chat: ChatRecord;
  /** Words around the match in a message, when the title didn't match. */
  snippet: string | null;
}

export interface NewMessage {
  role: MessageRole;
  text: string;
  content: unknown;
  status: MessageStatus;
  step?: string | null;
}

export interface MessagePatch {
  text?: string;
  content?: unknown;
  results?: unknown;
  status?: MessageStatus;
  step?: string | null;
}

export interface MicoAiRepository {
  /** The owner's chats, newest activity first; with `query`, those whose title or messages contain it. */
  listChats(userId: string, opts: { query?: string; limit: number }): Promise<ChatMatch[]>;
  createChat(userId: string, title: string): Promise<ChatRecord>;
  /** The chat, only if it is this person's. */
  getChat(userId: string, chatId: string): Promise<ChatRecord | null>;
  renameChat(userId: string, chatId: string, title: string): Promise<ChatRecord | null>;
  /** Permanently deletes the chat and its messages; false if it isn't this person's. */
  deleteChat(userId: string, chatId: string): Promise<boolean>;
  /** Every chat of a person, for good (when the person is deleted). */
  deleteAllForUser(userId: string): Promise<number>;
  setSummary(chatId: string, summary: string, summarizedCount: number): Promise<void>;
  countMessages(chatId: string): Promise<number>;
  /** The newest `limit` messages before `before` (a message id; none: the newest), oldest first, without results. */
  pageMessages(chatId: string, opts: { limit: number; before?: string }): Promise<{ messages: MessageRecord[]; hasMore: boolean }>;
  /** The newest `limit` messages with their results, oldest first (a new question's context). */
  recentMessages(chatId: string, limit: number): Promise<MessageWithResults[]>;
  /** Messages from `offset` (oldest first), without results (the running summary). */
  messageRange(chatId: string, offset: number, limit: number): Promise<MessageRecord[]>;
  getMessage(chatId: string, messageId: string): Promise<MessageRecord | null>;
  /** The question asked last before this message. */
  questionBefore(chatId: string, messageId: string): Promise<string | null>;
  /**
   * In one step that two requests can't interleave: unless an answer is still being written in the
   * chat, add the question and a pending answer. Pending answers untouched since `staleBefore` don't
   * count: they become `interrupted` first. 'busy' when an answer is still being written.
   */
  startTurn(
    chatId: string,
    turn: { question: string; step: string; staleBefore: Date; interrupted: unknown },
  ): Promise<{ question: MessageRecord; answer: MessageRecord } | 'busy'>;
  /** Add one message (tests, and anything outside a turn). */
  addMessage(chatId: string, message: NewMessage): Promise<MessageRecord>;
  /** Change a message; with `onlyIf`, only while it still has that status (true if it changed). */
  updateMessage(messageId: string, patch: MessagePatch, onlyIf?: MessageStatus): Promise<boolean>;
  /** Answers still pending but untouched since `before` (cut off by a restart) become `content` errors; in one chat or all. */
  interruptStale(before: Date, content: unknown, chatId?: string): Promise<number>;
}

/** Words around the first match of `query` in `text` (about 120 characters). */
export function snippetOf(text: string, query: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const at = clean.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return clean.slice(0, 120);
  const start = Math.max(0, at - 50);
  const end = Math.min(clean.length, at + query.length + 70);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

type StoredMessage = MessageWithResults;
const withoutResults = (m: StoredMessage): MessageRecord => {
  const { results: _results, ...rest } = m;
  void _results;
  return rest;
};

/** In-memory storage, for tests. */
export function createMemoryMicoAiRepository(now: () => Date = () => new Date()): MicoAiRepository & { messages: StoredMessage[]; chats: ChatRecord[] } {
  const chats: ChatRecord[] = [];
  const messages: StoredMessage[] = [];
  // A strictly increasing clock: rows made in the same millisecond still sort in the order they were made.
  let last = 0;
  const tick = () => {
    last = Math.max(last + 1, now().getTime());
    return new Date(last);
  };
  const own = (userId: string, chatId: string) => chats.find((c) => c.id === chatId && c.userId === userId) ?? null;
  const ofChat = (chatId: string) => messages.filter((m) => m.chatId === chatId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const insert = (chatId: string, m: NewMessage): StoredMessage => {
    const at = tick();
    const row: StoredMessage = { id: randomUUID(), chatId, role: m.role, text: m.text, content: m.content, results: null, status: m.status, step: m.step ?? null, createdAt: at, updatedAt: at };
    messages.push(row);
    const chat = chats.find((c) => c.id === chatId);
    if (chat) chat.lastMessageAt = at;
    return row;
  };
  const removeChat = (chat: ChatRecord) => {
    chats.splice(chats.indexOf(chat), 1);
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.chatId === chat.id) messages.splice(i, 1);
  };
  return {
    chats,
    messages,
    async listChats(userId, { query, limit }) {
      const q = query?.trim().toLowerCase();
      const mine = chats.filter((c) => c.userId === userId).sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      const out: ChatMatch[] = [];
      for (const chat of mine) {
        if (!q) out.push({ chat, snippet: null });
        else if (chat.title.toLowerCase().includes(q)) out.push({ chat, snippet: null });
        else {
          const hit = messages.find((m) => m.chatId === chat.id && m.text.toLowerCase().includes(q));
          if (hit) out.push({ chat, snippet: snippetOf(hit.text, q) });
        }
      }
      return out.slice(0, limit);
    },
    async createChat(userId, title) {
      const at = tick();
      const chat: ChatRecord = { id: randomUUID(), userId, title, summary: null, summarizedCount: 0, createdAt: at, updatedAt: at, lastMessageAt: at };
      chats.push(chat);
      return chat;
    },
    async getChat(userId, chatId) {
      return own(userId, chatId);
    },
    async renameChat(userId, chatId, title) {
      const chat = own(userId, chatId);
      if (!chat) return null;
      chat.title = title;
      chat.updatedAt = tick();
      return chat;
    },
    async deleteChat(userId, chatId) {
      const chat = own(userId, chatId);
      if (!chat) return false;
      removeChat(chat);
      return true;
    },
    async deleteAllForUser(userId) {
      const theirs = chats.filter((c) => c.userId === userId);
      for (const chat of theirs) removeChat(chat);
      return theirs.length;
    },
    async setSummary(chatId, summary, summarizedCount) {
      const chat = chats.find((c) => c.id === chatId);
      if (chat) Object.assign(chat, { summary, summarizedCount });
    },
    async countMessages(chatId) {
      return ofChat(chatId).length;
    },
    async pageMessages(chatId, { limit, before }) {
      const all = ofChat(chatId);
      const end = before ? all.findIndex((m) => m.id === before) : all.length;
      const stop = end < 0 ? 0 : end;
      const start = Math.max(0, stop - limit);
      return { messages: all.slice(start, stop).map(withoutResults), hasMore: start > 0 };
    },
    async recentMessages(chatId, limit) {
      return ofChat(chatId)
        .slice(-limit)
        .map((m) => ({ ...m }));
    },
    async messageRange(chatId, offset, limit) {
      return ofChat(chatId).slice(offset, offset + limit).map(withoutResults);
    },
    async getMessage(chatId, messageId) {
      const m = messages.find((x) => x.id === messageId && x.chatId === chatId);
      return m ? withoutResults(m) : null;
    },
    async questionBefore(chatId, messageId) {
      const all = ofChat(chatId);
      const at = all.findIndex((m) => m.id === messageId);
      return at < 0 ? null : ([...all.slice(0, at)].reverse().find((m) => m.role === 'user')?.text ?? null);
    },
    // No await between the check and the inserts: two calls can't interleave.
    async startTurn(chatId, turn) {
      const open = messages.filter((m) => m.chatId === chatId && m.status === 'PENDING');
      for (const m of open) if (m.updatedAt < turn.staleBefore) Object.assign(m, { status: 'ERROR', content: turn.interrupted, step: null, updatedAt: tick() });
      if (open.some((m) => m.status === 'PENDING')) return 'busy';
      const question = insert(chatId, { role: 'user', text: turn.question, content: null, status: 'DONE' });
      const answer = insert(chatId, { role: 'assistant', text: '', content: null, status: 'PENDING', step: turn.step });
      return { question: withoutResults(question), answer: withoutResults(answer) };
    },
    async addMessage(chatId, m) {
      return insert(chatId, m);
    },
    async updateMessage(messageId, patch, onlyIf) {
      const m = messages.find((x) => x.id === messageId);
      if (!m || (onlyIf && m.status !== onlyIf)) return false;
      Object.assign(m, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: tick() });
      return true;
    },
    async interruptStale(before, content, chatId) {
      let n = 0;
      for (const m of messages) {
        if (m.status === 'PENDING' && m.updatedAt < before && (!chatId || m.chatId === chatId)) {
          Object.assign(m, { status: 'ERROR', content, step: null, updatedAt: tick() });
          n++;
        }
      }
      return n;
    },
  };
}
