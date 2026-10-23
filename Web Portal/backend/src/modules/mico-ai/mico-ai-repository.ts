import { randomUUID } from 'node:crypto';

/**
 * Where MICO AI keeps a person's chats. Every chat read and change takes the owner's id, so a chat
 * can only ever be found by the person it belongs to (admins included: they can't open anyone
 * else's). Deleting a chat deletes its messages for good.
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
  /** The answer as JSON (AssistantContent), or { error } for a failed one; null for a question. */
  content: unknown;
  status: MessageStatus;
  /** While PENDING: what MICO AI is doing ("Checking tasks in Rig Inspection…"). */
  step: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  setSummary(chatId: string, summary: string, summarizedCount: number): Promise<void>;
  /** Oldest first. */
  listMessages(chatId: string): Promise<MessageRecord[]>;
  addMessage(chatId: string, message: NewMessage): Promise<MessageRecord>;
  getMessage(chatId: string, messageId: string): Promise<MessageRecord | null>;
  /** Change a message; with `onlyIf`, only while it still has that status (true if it changed). */
  updateMessage(messageId: string, patch: MessagePatch, onlyIf?: MessageStatus): Promise<boolean>;
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

/** In-memory storage, for tests. */
export function createMemoryMicoAiRepository(now: () => Date = () => new Date()): MicoAiRepository & { messages: MessageRecord[]; chats: ChatRecord[] } {
  const chats: ChatRecord[] = [];
  const messages: MessageRecord[] = [];
  // A strictly increasing clock: rows made in the same millisecond still sort in the order they were made.
  let last = 0;
  const tick = () => {
    last = Math.max(last + 1, now().getTime());
    return new Date(last);
  };
  const own = (userId: string, chatId: string) => chats.find((c) => c.id === chatId && c.userId === userId) ?? null;
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
      chats.splice(chats.indexOf(chat), 1);
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.chatId === chatId) messages.splice(i, 1);
      return true;
    },
    async setSummary(chatId, summary, summarizedCount) {
      const chat = chats.find((c) => c.id === chatId);
      if (chat) Object.assign(chat, { summary, summarizedCount });
    },
    async listMessages(chatId) {
      return messages.filter((m) => m.chatId === chatId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async addMessage(chatId, m) {
      const at = tick();
      const row: MessageRecord = { id: randomUUID(), chatId, role: m.role, text: m.text, content: m.content, status: m.status, step: m.step ?? null, createdAt: at, updatedAt: at };
      messages.push(row);
      const chat = chats.find((c) => c.id === chatId);
      if (chat) chat.lastMessageAt = at;
      return row;
    },
    async getMessage(chatId, messageId) {
      return messages.find((m) => m.id === messageId && m.chatId === chatId) ?? null;
    },
    async updateMessage(messageId, patch, onlyIf) {
      const m = messages.find((x) => x.id === messageId);
      if (!m || (onlyIf && m.status !== onlyIf)) return false;
      Object.assign(m, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: tick() });
      return true;
    },
  };
}
