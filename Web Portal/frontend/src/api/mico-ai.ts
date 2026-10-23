import type { ApiClient } from '../lib/api-client';

/** MICO AI: the signed-in person's own chats with the read-only assistant (mirrors the backend). */

export type SourceType = 'task' | 'project' | 'meeting' | 'chat' | 'person';

export interface MicoAiSource {
  type: SourceType;
  id: string;
  label: string;
  /** A website path; '?task=<id>' opens the task panel on the current page. Null for a person. */
  url: string | null;
}

export type CellKind = 'text' | 'key' | 'date' | 'datetime' | 'number' | 'percent' | 'days';
export type CellValue = string | number | null;

export interface MicoAiTable {
  title: string;
  fromResult: string;
  columns: Array<{ key: string; label: string; kind?: CellKind }>;
  rows: Array<{ ref: MicoAiSource | null; cells: CellValue[] }>;
}

export interface MicoAiAnswer {
  kind: 'answer' | 'clarify';
  unavailable: boolean;
  tables: MicoAiTable[];
  sources: MicoAiSource[];
  followUps: string[];
  options: string[];
}

export interface MicoAiMessage {
  id: string;
  role: 'user' | 'assistant';
  status: 'pending' | 'done' | 'error' | 'stopped';
  /** The question, or the answer (paragraphs, "- " bullets, **bold**). */
  text: string;
  createdAt: string;
  /** While pending: what MICO AI is doing. */
  step: string | null;
  answer?: MicoAiAnswer;
  error?: string;
}

export interface MicoAiChat {
  id: string;
  /** '' until the first question names it. */
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  /** For a search: words around the match in a message. */
  match: string | null;
}

export const MICO_AI_CHATS_KEY = ['mico-ai', 'chats'] as const;
export const micoAiChatKey = (id: string) => ['mico-ai', 'chat', id] as const;

export function micoAiApi(client: ApiClient) {
  const base = '/mico-ai/chats';
  const chat = (id: string) => `${base}/${encodeURIComponent(id)}`;
  const message = (chatId: string, messageId: string) => `${chat(chatId)}/messages/${encodeURIComponent(messageId)}`;
  return {
    status: () => client.get<{ data: { ready: boolean; message: string | null } }>('/mico-ai/status').then((r) => r.data),
    list: (q?: string) => client.get<{ data: MicoAiChat[] }>(q?.trim() ? `${base}?q=${encodeURIComponent(q.trim())}` : base).then((r) => r.data),
    create: (title?: string) => client.post<{ data: MicoAiChat }>(base, title ? { title } : {}).then((r) => r.data),
    get: (id: string) => client.get<{ data: { chat: MicoAiChat; messages: MicoAiMessage[] } }>(chat(id)).then((r) => r.data),
    rename: (id: string, title: string) => client.patch<{ data: MicoAiChat }>(chat(id), { title }).then((r) => r.data),
    remove: (id: string) => client.del(chat(id)),
    ask: (id: string, text: string) => client.post<{ data: { question: MicoAiMessage; answer: MicoAiMessage } }>(`${chat(id)}/messages`, { text }).then((r) => r.data),
    message: (chatId: string, messageId: string) => client.get<{ data: MicoAiMessage }>(message(chatId, messageId)).then((r) => r.data),
    stop: (chatId: string, messageId: string) => client.post<{ data: MicoAiMessage }>(`${message(chatId, messageId)}/stop`).then((r) => r.data),
    /** Table n (1 = the first) of an answer, as Excel or PDF. */
    download: (chatId: string, messageId: string, n: number, format: 'xlsx' | 'pdf') => client.getBlob(`${message(chatId, messageId)}/tables/${n}.${format}`),
  };
}
