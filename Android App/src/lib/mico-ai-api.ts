import type { ApiClient, CallOpts } from './api-client';
import type { FinalMinutesContent, Priority } from './types';

/**
 * MICO AI: the signed-in person's own chats with the read-only assistant — the server's types and
 * requests as the website's `frontend/src/api/mico-ai.ts` has them (Stage 3 Task 11; the drift test
 * compares the fields). Every request takes whose it is (`asUser`) as its last argument.
 */

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
  /** How many matched in all (more than the rows when the list was capped). */
  total?: number;
}

// ── A card of proposed changes (mirrors the backend's mico-ai-actions-types) ──
export interface MicoAiNamed {
  id: string;
  name: string;
}

/** What happened to one change once the card was confirmed ('started': being made right now). */
export interface ProposalResult {
  status: 'done' | 'refused' | 'failed' | 'skipped' | 'started';
  message: string | null;
  /** Where to see it ("RIG-31"): '?task=<id>' opens the task. */
  link: { label: string; url: string } | null;
}

/** What Undo did to one change ('started': being put back right now). */
export interface ProposalUndo {
  status: 'undone' | 'refused' | 'failed' | 'started';
  message: string | null;
  /** What the change made no longer exists (a new task or meeting Undo deleted): nothing to open. */
  gone?: boolean;
}

/**
 * Something to put right before a change can go ahead. An edit to any of `fields` (the edit's own
 * names) clears it on the card; the server checks the change again on Confirm. No fields: editing
 * can't fix it.
 */
export interface ProposalNeed {
  fields: string[];
  message: string;
}

interface ChangeBase {
  /** c1, c2 … within the card. */
  id: string;
  /** What has to be put right first: the change can't be ticked until each is edited. */
  needs: ProposalNeed[];
  /** In words: the needs' messages, or why a locked change can't go ahead. */
  problem: string | null;
  /** It can't go ahead at all: no tick box. */
  locked: boolean;
  /** Worth a look but fine. */
  warning: string | null;
  result: ProposalResult | null;
  undo: ProposalUndo | null;
}

export interface CreateTaskFields {
  title: string;
  projectId: string | null;
  assigneeIds: string[];
  /** 'YYYY-MM-DD' or none. */
  due: string | null;
  priority: Priority;
  description: string;
}
export interface CreateTaskChange extends ChangeBase {
  type: 'create_task';
  fields: CreateTaskFields;
  labels: { project: string | null; assignees: MicoAiNamed[] };
  /** No one was named, so it goes to the project's owner. */
  ownerDefault?: boolean;
}

export interface TaskChangeFields {
  due?: string | null;
  priority?: Priority;
  columnId?: string;
  assigneeIds?: string[];
}
export interface UpdateTaskChange extends ChangeBase {
  type: 'update_task';
  task: { id: string; key: string; title: string; projectId: string; project: string; url: string };
  base: { version: number; assigneeIds: string[]; activity: number };
  before: { due: string | null; priority: Priority; columnId: string; column: string; assignees: MicoAiNamed[] };
  /** Only the fields that change. */
  fields: TaskChangeFields;
  labels: { column?: string; assignees?: MicoAiNamed[] };
}

export interface MinutesChange extends ChangeBase {
  type: 'draft_minutes';
  meeting: { id: string; title: string; startAt: string; url: string };
  fields: { content: FinalMinutesContent };
  base: { status: 'NONE' | 'DRAFT' | 'APPROVED'; savedAt: string | null };
}

export interface MeetingFields {
  title: string;
  projectId: string | null;
  /** 'YYYY-MM-DD' and 'HH:MM' in the company time zone. */
  date: string | null;
  time: string | null;
  minutes: number;
  attendeeIds: string[];
  agenda: string[];
  description: string;
}
export interface MeetingChange extends ChangeBase {
  type: 'schedule_meeting';
  fields: MeetingFields;
  labels: { project: string | null; attendees: MicoAiNamed[] };
}

export type ProposalChange = CreateTaskChange | UpdateTaskChange | MinutesChange | MeetingChange;
/** 'superseded': the person asked the same again (Retry), so this unconfirmed card was replaced. */
export type ProposalStatus = 'proposed' | 'confirming' | 'done' | 'cancelled' | 'undoing' | 'undone' | 'superseded';

/** MICO AI's card of proposed changes: nothing happens until the person confirms it. */
export interface MicoAiProposal {
  id: string;
  status: ProposalStatus;
  note: string | null;
  /** The card's "Email the invitations" switch. */
  sendInvites: boolean;
  /** A meeting is on the card (so "Email the invitations" applies). */
  hasMeetings: boolean;
  items: ProposalChange[];
  confirmedAt: string | null;
  /** Until when Undo is open (ISO). */
  undoUntil: string | null;
  canUndo: boolean;
  /** The server's clock when this was read (ISO): the Undo countdown follows it, not the phone's clock. */
  serverNow: string;
}

/** What Confirm sends: which changes are ticked, and the person's own edits (checked again on the server). */
export interface ConfirmBody {
  items: Array<{ id: string; include: boolean; edits?: Record<string, unknown> }>;
  sendInvites?: boolean;
}

export interface MicoAiAnswer {
  kind: 'answer' | 'clarify' | 'proposal';
  unavailable: boolean;
  tables: MicoAiTable[];
  sources: MicoAiSource[];
  followUps: string[];
  options: string[];
  /** A card of proposed changes (kind 'proposal'). */
  proposal?: MicoAiProposal;
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

/** A chat with its latest messages; `hasMore`: older ones can be loaded with `older()`. */
export interface ChatView {
  chat: MicoAiChat;
  messages: MicoAiMessage[];
  hasMore?: boolean;
}

type Envelope<T> = { data: T };

export function micoAiApi(client: ApiClient) {
  const data = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);
  const base = '/mico-ai/chats';
  const chat = (id: string) => `${base}/${encodeURIComponent(id)}`;
  const message = (chatId: string, messageId: string) => `${chat(chatId)}/messages/${encodeURIComponent(messageId)}`;
  return {
    status: (o?: CallOpts) => data(client.get<Envelope<{ ready: boolean; message: string | null }>>('/mico-ai/status', o)),
    /** The person's chats, newest first; `q`: only those whose words match. */
    chats: (q?: string, o?: CallOpts) => data(client.get<Envelope<MicoAiChat[]>>(q?.trim() ? `${base}?q=${encodeURIComponent(q.trim())}` : base, o)),
    create: (o?: CallOpts) => data(client.post<Envelope<MicoAiChat>>(base, {}, o)),
    /** The chat with its latest messages. */
    chat: (id: string, o?: CallOpts) => data(client.get<Envelope<ChatView>>(chat(id), o)),
    older: (id: string, before: string, o?: CallOpts) =>
      data(client.get<Envelope<{ messages: MicoAiMessage[]; hasMore: boolean }>>(`${chat(id)}/messages?before=${encodeURIComponent(before)}`, o)),
    rename: (id: string, title: string, o?: CallOpts) => data(client.patch<Envelope<MicoAiChat>>(chat(id), { title }, o)),
    remove: (id: string, o?: CallOpts) => client.del<void>(chat(id), o),
    /** Ask a question; `retryOf`: the answer being asked again (its unconfirmed card is replaced). */
    ask: (id: string, text: string, retryOf?: string, o?: CallOpts) =>
      data(client.post<Envelope<{ question: MicoAiMessage; answer: MicoAiMessage }>>(`${chat(id)}/messages`, retryOf ? { text, retryOf } : { text }, o)),
    message: (chatId: string, messageId: string, o?: CallOpts) => data(client.get<Envelope<MicoAiMessage>>(message(chatId, messageId), o)),
    stop: (chatId: string, messageId: string, o?: CallOpts) => data(client.post<Envelope<MicoAiMessage>>(`${message(chatId, messageId)}/stop`, undefined, o)),
    /** Carry out a card's ticked changes, with the person's edits (a repeat returns the same result). */
    confirm: (chatId: string, messageId: string, body: ConfirmBody, o?: CallOpts) => data(client.post<Envelope<MicoAiMessage>>(`${message(chatId, messageId)}/confirm`, body, o)),
    /** Close a card without changing anything. */
    cancel: (chatId: string, messageId: string, o?: CallOpts) => data(client.post<Envelope<MicoAiMessage>>(`${message(chatId, messageId)}/cancel`, undefined, o)),
    /** Put a confirmed card's changes back (for 15 minutes, where nobody changed them since). */
    undo: (chatId: string, messageId: string, o?: CallOpts) => data(client.post<Envelope<MicoAiMessage>>(`${message(chatId, messageId)}/undo`, undefined, o)),
    /** Table n (1 = the first) of an answer, as Excel or PDF: the path the exporter downloads. */
    tablePath: (chatId: string, messageId: string, n: number, fmt: 'xlsx' | 'pdf') => `${message(chatId, messageId)}/tables/${n}.${fmt}`,
    /** The whole answer (its words, every table, its sources) as one PDF report. */
    reportPath: (chatId: string, messageId: string) => `${message(chatId, messageId)}/report.pdf`,
  };
}

export type MicoAiApi = ReturnType<typeof micoAiApi>;
