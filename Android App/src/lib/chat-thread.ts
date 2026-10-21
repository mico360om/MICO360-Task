import type { InfiniteData } from '@tanstack/react-query';
import type { ApiChatMessage } from './types';
import type { OutboxEntry } from './chat-outbox';

/**
 * A conversation's history as the phone holds it (3a): pages from the server, the newest page
 * first, each page oldest message first — the server's own order (`GET
 * /conversations/:id/messages?before=&limit=`). Live and just-sent messages are put into these
 * pages directly, so the history is never reloaded for one new message. Pure, so it is tested here.
 */

/** Messages per page (the server's default; it allows up to 100). */
export const CHAT_PAGE_SIZE = 50;

/** The thread's pages; the page param is the `before` cursor (undefined for the newest page). */
export type ThreadPages = InfiniteData<ApiChatMessage[], string | undefined>;

/**
 * Where the page older than this one starts: before its oldest message (the server returns the
 * messages created strictly before it). A page that wasn't full was the beginning.
 */
export function olderPageCursor(page: ApiChatMessage[]): string | undefined {
  return Array.isArray(page) && page.length >= CHAT_PAGE_SIZE ? page[0]?.createdAt : undefined;
}

/** A message with its lists always there (an event may leave them out). */
export function completeMessage(m: ApiChatMessage): ApiChatMessage {
  return { ...m, reactions: Array.isArray(m.reactions) ? m.reactions : [], attachments: Array.isArray(m.attachments) ? m.attachments : [] };
}

const isPages = (data: unknown): data is ThreadPages => !!data && Array.isArray((data as ThreadPages).pages);

/** Every loaded message, newest first (the inverted list's order), each once. */
export function threadMessages(data: ThreadPages | undefined): ApiChatMessage[] {
  if (!isPages(data)) return [];
  const seen = new Set<string>();
  const out: ApiChatMessage[] = [];
  for (const page of data.pages) {
    const list = Array.isArray(page) ? page : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]!;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/**
 * Put a message into the thread: in place when a page holds it already (an edit, or the same
 * message from both the send's answer and the live event), else into the newest page in time order.
 * A thread that hasn't loaded is left alone — it loads fresh when opened.
 */
export function upsertThreadMessage(data: ThreadPages | undefined, message: ApiChatMessage): ThreadPages | undefined {
  if (!isPages(data)) return data;
  const m = completeMessage(message);
  let found = false;
  const next = data.pages.map((page) => {
    const list = Array.isArray(page) ? page : [];
    const at = list.findIndex((x) => x.id === m.id);
    if (at === -1) return page;
    found = true;
    const copy = list.slice();
    copy[at] = { ...list[at]!, ...m };
    return copy;
  });
  if (!found) {
    const newest = Array.isArray(next[0]) ? next[0]!.slice() : [];
    let at = newest.length;
    while (at > 0 && newest[at - 1]!.createdAt > m.createdAt) at--;
    newest.splice(at, 0, m);
    next[0] = newest;
  }
  return { ...data, pages: next };
}

/** Change one loaded message where it is; the same data comes back when no page holds it. */
export function patchThreadMessage(
  data: ThreadPages | undefined,
  id: string,
  change: (m: ApiChatMessage) => ApiChatMessage,
): ThreadPages | undefined {
  if (!isPages(data)) return data;
  let found = false;
  const next = data.pages.map((page) => {
    const list = Array.isArray(page) ? page : [];
    const at = list.findIndex((x) => x.id === id);
    if (at === -1) return page;
    found = true;
    const copy = list.slice();
    copy[at] = change(list[at]!);
    return copy;
  });
  return found ? { ...data, pages: next } : data;
}

/** What the phone keeps to read offline: the newest page, at most a page of the newest messages. */
export function newestPageCopy(data: ThreadPages | undefined): ApiChatMessage[] {
  if (!isPages(data)) return [];
  const newest = Array.isArray(data.pages[0]) ? data.pages[0]! : [];
  return newest.length > CHAT_PAGE_SIZE ? newest.slice(newest.length - CHAT_PAGE_SIZE) : newest;
}

/** One row of the thread: a message the server has, or one still on this phone (chat-outbox). */
export type ThreadItem =
  | { kind: 'message'; key: string; userId: string; message: ApiChatMessage }
  | { kind: 'outbox'; key: string; userId: string; entry: OutboxEntry };

/**
 * The thread's rows, newest first (the inverted list's order): the messages still on this phone at
 * the newest end — they are on their way — then the history.
 */
export function threadItems(data: ThreadPages | undefined, outbox: readonly OutboxEntry[], myId: string): ThreadItem[] {
  const waiting: ThreadItem[] = [];
  for (let i = outbox.length - 1; i >= 0; i--) {
    const entry = outbox[i]!;
    waiting.push({ kind: 'outbox', key: `out-${entry.queueId}`, userId: myId, entry });
  }
  return [...waiting, ...threadMessages(data).map<ThreadItem>((message) => ({ kind: 'message', key: `msg-${message.id}`, userId: message.userId, message }))];
}
