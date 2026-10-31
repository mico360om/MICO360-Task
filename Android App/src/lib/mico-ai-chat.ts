import { ApiError, isNetworkError, NetworkError } from './api-client';
import { isSafeId } from './ids';
import { copyTextOf } from './mico-ai';
import type { ChatView, MicoAiMessage, MicoAiSource } from './mico-ai-api';
import { normalizeLinkPath } from '../navigation/linking';
import type { NavAction } from '../navigation/nav-actions';

/**
 * MICO AI's chat state on the phone (Stage 3 Task 12): the website's MicoAiPage rules — which
 * answer is followed, how a polled message replaces its copy, what a failed question or card action
 * does next, the words a screen reader hears — plus the per-person query keys (Review Focus 2) and
 * the one-action-at-a-time gate of a card (Review Focus 3).
 */

/** A pending answer is read again every second, as the website does. */
export const MICO_AI_POLL_MS = 1000;
/** A card being made or put back is read again every two seconds. */
export const CARD_POLL_MS = 2000;
/** The longest question (the website's MAX_QUESTION). */
export const MAX_QUESTION = 4000;
/** The longest chat name (the website's rename box). */
export const CHAT_TITLE_MAX = 200;
/** Confirm and Undo make the changes before answering: their own time limit. */
export const MICO_AI_ACTION_TIMEOUT_MS = 120_000;

// ── Query keys: every one carries whose chats they are, so the next person on the phone never sees them ──
export const micoAiRoot = (userId: string | null) => ['mico-ai', userId] as const;
export const micoAiStatusKey = (userId: string | null) => [...micoAiRoot(userId), 'status'] as const;
/** Every chat list of the person (each search is its own list). */
export const micoAiChatsRoot = (userId: string | null) => [...micoAiRoot(userId), 'chats'] as const;
export const micoAiChatsKey = (userId: string | null, q: string) => [...micoAiChatsRoot(userId), q.trim()] as const;
export const micoAiChatKey = (userId: string | null, chatId: string) => [...micoAiRoot(userId), 'chat', chatId] as const;
/** The older messages loaded above a chat's latest ones ("Load earlier messages"; never fetched by itself). */
export const micoAiEarlierKey = (userId: string | null, chatId: string) => [...micoAiRoot(userId), 'earlier', chatId] as const;
export const micoAiMessageKey = (userId: string | null, chatId: string, messageId: string) => [...micoAiRoot(userId), 'message', chatId, messageId] as const;

/** The older messages kept above a chat's latest ones. */
export interface EarlierPage {
  messages: MicoAiMessage[];
  hasMore: boolean;
}

/** The answer being written (the one followed): the first assistant message still pending. */
export function pendingAnswer(messages: readonly MicoAiMessage[]): MicoAiMessage | null {
  return messages.find((m) => m.role === 'assistant' && m.status === 'pending') ?? null;
}

/** Older messages above the latest ones, none twice (the website's MicoAiPage `messages`). */
export function withEarlier(latest: readonly MicoAiMessage[], earlier: readonly MicoAiMessage[]): MicoAiMessage[] {
  return [...earlier.filter((o) => !latest.some((x) => x.id === o.id)), ...latest];
}

const sameMessage = (a: MicoAiMessage, b: MicoAiMessage) =>
  a.status === b.status && a.step === b.step && a.text === b.text && a.error === b.error && JSON.stringify(a.answer) === JSON.stringify(b.answer);

/**
 * The chat with one message as the server now has it. The same object when that message isn't in
 * it or nothing about it changed, so a poll that brings nothing new redraws nothing.
 */
export function withMessage(view: ChatView | undefined, m: MicoAiMessage): ChatView | undefined {
  if (!view) return view;
  const at = view.messages.findIndex((x) => x.id === m.id);
  if (at < 0 || sameMessage(view.messages[at]!, m)) return view;
  return { ...view, messages: view.messages.map((x, i) => (i === at ? m : x)) };
}

/** The same for the older messages kept above the latest ones. */
export function earlierWithMessage(page: EarlierPage | undefined, m: MicoAiMessage): EarlierPage | undefined {
  if (!page) return page;
  const at = page.messages.findIndex((x) => x.id === m.id);
  if (at < 0 || sameMessage(page.messages[at]!, m)) return page;
  return { ...page, messages: page.messages.map((x, i) => (i === at ? m : x)) };
}

/** The chat was deleted elsewhere (another phone or the website): the server no longer has it. */
export const isGoneError = (err: unknown): boolean => err instanceof ApiError && err.status === 404;

/** The answer a deleted chat was writing, as stopped: nothing follows it any more. */
export const goneCopy = (m: MicoAiMessage): MicoAiMessage => ({ ...m, status: 'stopped', step: null });

/** A poll tries a lost answer twice more; a deleted chat (404) stops it at once. */
export function pollRetry(failureCount: number, error: unknown): boolean {
  return !isGoneError(error) && failureCount < 2;
}

/**
 * The sentence for a request that failed: the server's own words for a refusal, else a plain cause
 * (the website's errorText). "Request failed (N)" and the exporter's "Export failed (N)" are the
 * app's placeholders, not the server's words.
 */
export function errorText(err: unknown): string {
  if (err instanceof ApiError && err.status < 500 && err.message && !/^(?:Request|Export) failed/.test(err.message)) return err.message;
  if (isNetworkError(err)) return 'Couldn’t reach the server. Check your connection and try again.';
  return 'Something went wrong. Try again.';
}

/**
 * What follows a question that failed. One whose answer was lost on the way may be on the server:
 * the chat is read again, the question isn't put back in the box (sending it again would ask it
 * twice) and the chat made for it stays. A 409 (MICO AI still busy) is read again too. Anything
 * else surely never arrived: the question goes back in the box and a chat made just for it goes.
 */
export function afterAskFailed(err: unknown, newChat: boolean): { reread: boolean; deleteNewChat: boolean; restoreDraft: boolean } {
  if (err instanceof NetworkError && err.mayHaveArrived) return { reread: true, deleteNewChat: false, restoreDraft: false };
  if (err instanceof ApiError && err.status === 409) return { reread: true, deleteNewChat: false, restoreDraft: true };
  return { reread: false, deleteNewChat: newChat, restoreDraft: true };
}

/**
 * After a question whose answer was lost, the chat as read back: did a question that wasn't there
 * before arrive? (`before`: the chat's message ids just before asking.)
 */
export function askArrived(before: ReadonlySet<string>, messages: readonly MicoAiMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && !before.has(m.id));
}

/**
 * What the read-back decides (`arrived` null: it failed too): a question that arrived was asked —
 * no error, nothing to send again; one that didn't, or nobody knows, goes back in the box.
 */
export function afterReadBack(arrived: boolean | null): { restoreDraft: boolean; clearError: boolean } {
  return arrived ? { restoreDraft: false, clearError: true } : { restoreDraft: true, clearError: false };
}

/**
 * One action at a time (a card's Confirm, Cancel and Undo): the flag is set before the first await,
 * so a second tap while one runs returns undefined without calling anything.
 */
export function createActionGate(): { readonly busy: boolean; run<T>(fn: () => Promise<T>): Promise<T | undefined> } {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
  };
}

/**
 * What a confirmed (or undone) card can change: the app's lists read again so open screens show it
 * — the app's roots for the website's list (tasks of every kind, the calendar's and the board's,
 * a task and its activity, projects, meetings, action items, the Dashboard, the Activity page,
 * Timeline/Workload and Management).
 */
export const CHANGED_BY_CARDS: ReadonlySet<string> = new Set(['tasks', 'task', 'meetings', 'meeting', 'project', 'projects', 'action-items', 'dashboard', 'planning', 'management', 'activity']);

const SCREEN_OF: Record<string, (id: string) => NavAction> = {
  task: (taskId) => ({ type: 'stack', screen: 'TaskDetail', params: { taskId } }),
  project: (projectId) => ({ type: 'stack', screen: 'ProjectDetail', params: { projectId } }),
  meeting: (meetingId) => ({ type: 'stack', screen: 'MeetingDetail', params: { meetingId } }),
  chat: (conversationId) => ({ type: 'stack', screen: 'ChatThread', params: { conversationId } }),
};

/**
 * The app's screen for a website address MICO AI sent: '?task=<id>' (on any page), '/projects/<id>',
 * '/meetings/<id>', '/chat?conversation=<id>'. Null for none, any other address, another site, or
 * an id that isn't an id.
 */
export function linkTarget(url: string | null): NavAction | null {
  if (!url || !/^(?:\/(?!\/)|\?)/.test(url)) return null;
  const m = /^\/?(task|project|meeting|chat)\/([^/?#]+)$/.exec(normalizeLinkPath(url));
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[2]!);
  } catch {
    return null;
  }
  return isSafeId(id) ? SCREEN_OF[m[1]!]!(id) : null;
}

/** Where a source chip goes (a person has none). */
export const sourceTarget = (s: MicoAiSource): NavAction | null => linkTarget(s.url);

/** What a screen reader hears once when MICO AI starts on a question. */
const WORKING = 'MICO AI is working on your question…';

/** The words a screen reader hears for an answer (the website's live region); none for a question. */
export function announce(m: MicoAiMessage): string | null {
  if (m.role !== 'assistant') return null;
  if (m.status === 'pending') return WORKING;
  if (m.status === 'stopped') return 'MICO AI stopped.';
  if (m.status === 'error') return `MICO AI couldn’t answer: ${m.error ?? ''}`;
  if (m.answer?.kind === 'proposal') return `MICO AI suggests changes: ${m.text.slice(0, 300)} Nothing changes until you confirm them.`;
  return `MICO AI answered: ${copyTextOf(m).slice(0, 400)}`;
}

/** What the conversation showed at the last look: where it scrolls next is decided by what changed. */
export interface ScrollSeen {
  /** undefined: nothing seen yet. */
  chatId: string | null | undefined;
  first: string | null;
  last: string | null;
  pendingId: string | null;
  step: string | null;
}

/** Where the conversation should scroll: to its end, its top, or the start of an answer. */
export type ScrollWant = { kind: 'end' } | { kind: 'top' } | { kind: 'start'; id: string } | null;

/**
 * The website's MicoAiPage rule for where the conversation scrolls, by what changed since the last look:
 * - another chat: its newest message (a new chat opens at its top: the greeting first);
 * - older messages came in above ("Load earlier messages"): you stay where you were;
 * - a new message at the end (you asked): the end;
 * - an answer finished while you followed it: its start (the screen goes to the end instead when it
 *   is no taller than the view);
 * - a new progress step: the end, only if you are already there.
 * Anything else — growth you caused (Edit, Show all rows, a section opened) — moves nothing.
 */
export function scrollWant(was: ScrollSeen, now: ScrollSeen, count: number, atEnd: boolean): ScrollWant {
  if (now.chatId !== was.chatId) return count ? { kind: 'end' } : { kind: 'top' };
  if (now.first !== was.first && now.last === was.last) return null;
  if (now.last !== was.last) return count ? { kind: 'end' } : { kind: 'top' };
  if (was.pendingId && was.pendingId !== now.pendingId) return atEnd ? { kind: 'start', id: was.pendingId } : null;
  if (now.step !== was.step && atEnd) return { kind: 'end' };
  return null;
}
