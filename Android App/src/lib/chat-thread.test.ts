import { describe, it, expect } from 'vitest';
import {
  CHAT_PAGE_SIZE,
  completeMessage,
  newestPageCopy,
  newestPageOnly,
  olderPageCursor,
  patchThreadMessage,
  threadItems,
  threadMessages,
  upsertThreadMessage,
  type ThreadPages,
} from './chat-thread';
import type { ApiChatMessage } from './types';
import type { OutboxEntry } from './chat-outbox';

const msg = (id: string, at: string, over: Partial<ApiChatMessage> = {}): ApiChatMessage => ({
  id,
  conversationId: 'c1',
  userId: 'u2',
  body: id,
  editedAt: null,
  deletedAt: null,
  createdAt: `2026-10-21T08:${at}:00.000Z`,
  reactions: [],
  attachments: [],
  ...over,
});
const pages = (...ps: ApiChatMessage[][]): ThreadPages => ({ pages: ps, pageParams: ps.map((_, i) => (i === 0 ? undefined : `cursor-${i}`)) });
const fullPage = (from: number): ApiChatMessage[] =>
  Array.from({ length: CHAT_PAGE_SIZE }, (_, i) => msg(`m${from + i}`, String(i).padStart(2, '0')));

// 3a review fix 5: every refetch reads every loaded page in turn; a thread left keeps only its newest page.
describe('newestPageOnly (a thread left is trimmed to its newest page)', () => {
  it('keeps the newest page and its place, and drops the older ones', () => {
    const data = pages([msg('c', '03')], [msg('b', '02')], [msg('a', '01')]);
    expect(newestPageOnly(data)).toEqual({ pages: [[msg('c', '03')]], pageParams: [undefined] });
  });
  it('leaves a one-page thread, or none, as it is', () => {
    const one = pages([msg('a', '01')]);
    expect(newestPageOnly(one)).toBe(one);
    expect(newestPageOnly(undefined)).toBeUndefined();
  });
});

describe('olderPageCursor (paging back through history, as the server pages it)', () => {
  it('asks for the page before the oldest message of a full page (before = its createdAt)', () => {
    const page = fullPage(0);
    expect(olderPageCursor(page)).toBe(page[0]!.createdAt);
  });
  it('has nothing older after a page that was not full: the beginning of the conversation', () => {
    expect(olderPageCursor([msg('a', '01'), msg('b', '02')])).toBeUndefined();
    expect(olderPageCursor([])).toBeUndefined();
  });
  it('treats an answer that is not a list as the end', () => {
    expect(olderPageCursor(null as unknown as ApiChatMessage[])).toBeUndefined();
  });
});

describe('threadMessages (what the inverted list shows, newest first)', () => {
  it('runs from the newest message back to the oldest loaded, across pages', () => {
    const data = pages([msg('c', '03'), msg('d', '04')], [msg('a', '01'), msg('b', '02')]);
    expect(threadMessages(data).map((m) => m.id)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('shows a message two pages both hold once (a page boundary that moved)', () => {
    const data = pages([msg('b', '02'), msg('c', '03')], [msg('a', '01'), msg('b', '02')]);
    expect(threadMessages(data).map((m) => m.id)).toEqual(['c', 'b', 'a']);
  });
  it('is empty before anything has loaded', () => {
    expect(threadMessages(undefined)).toEqual([]);
  });
});

describe('upsertThreadMessage (a live or just-sent message put in without reloading the history)', () => {
  it('adds a new message to the newest page, in time order', () => {
    const data = pages([msg('a', '01'), msg('c', '03')]);
    const next = upsertThreadMessage(data, msg('b', '02'));
    expect(next!.pages[0]!.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(upsertThreadMessage(next, msg('d', '04'))!.pages[0]!.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('replaces a message it already holds, in whichever page it is (no second copy)', () => {
    const data = pages([msg('c', '03')], [msg('a', '01'), msg('b', '02')]);
    const next = upsertThreadMessage(data, msg('a', '01', { body: 'edited' }))!;
    expect(threadMessages(next).map((m) => m.id)).toEqual(['c', 'b', 'a']);
    expect(next.pages[1]![0]!.body).toBe('edited');
  });
  it('leaves a thread that has not loaded alone (it loads fresh when opened)', () => {
    expect(upsertThreadMessage(undefined, msg('a', '01'))).toBeUndefined();
  });
  it('fills in the lists an event may leave out', () => {
    const bare = { ...msg('a', '01') } as Partial<ApiChatMessage>;
    delete bare.reactions;
    delete bare.attachments;
    const next = upsertThreadMessage(pages([]), bare as ApiChatMessage)!;
    expect(next.pages[0]![0]).toMatchObject({ reactions: [], attachments: [] });
  });
});

describe('patchThreadMessage', () => {
  it('changes one message where it is and leaves the rest as they were', () => {
    const data = pages([msg('b', '02')], [msg('a', '01')]);
    const next = patchThreadMessage(data, 'a', (m) => ({ ...m, deletedAt: 'now', body: '' }))!;
    expect(next.pages[1]![0]).toMatchObject({ id: 'a', deletedAt: 'now', body: '' });
    expect(next.pages[0]).toBe(data.pages[0]);
  });
  it('returns the same data when the message is not loaded', () => {
    const data = pages([msg('b', '02')]);
    expect(patchThreadMessage(data, 'zz', (m) => ({ ...m, body: 'x' }))).toBe(data);
  });
});

describe('newestPageCopy (what is kept on the phone to read offline)', () => {
  it('is the newest page, at most a page long (live messages added to it included)', () => {
    const data = pages([...fullPage(0), msg('live', '59')]);
    const copy = newestPageCopy(data);
    expect(copy).toHaveLength(CHAT_PAGE_SIZE);
    expect(copy[copy.length - 1]!.id).toBe('live');
    expect(copy[0]!.id).toBe('m1');
  });
  it('is empty with nothing loaded', () => {
    expect(newestPageCopy(undefined)).toEqual([]);
  });
});

describe('completeMessage', () => {
  it('keeps the lists present', () => {
    expect(completeMessage({ ...msg('a', '01'), reactions: undefined, attachments: undefined } as unknown as ApiChatMessage)).toMatchObject({
      reactions: [],
      attachments: [],
    });
  });
});

describe('threadItems (server messages and the ones still on the phone, newest first)', () => {
  const entry = (queueId: string, at: string, over: Partial<OutboxEntry> = {}): OutboxEntry => ({
    queueId,
    clientId: queueId,
    conversationId: 'c1',
    body: queueId,
    createdAt: `2026-10-21T09:${at}:00.000Z`,
    state: 'sending',
    ...over,
  });
  it('puts the messages still on the phone at the newest end, newest first', () => {
    const data = pages([msg('a', '01'), msg('b', '02')]);
    const items = threadItems(data, [entry('q1', '01'), entry('q2', '02')], 'me');
    expect(items.map((i) => i.key)).toEqual(['out-q2', 'out-q1', 'msg-b', 'msg-a']);
    expect(items[0]).toMatchObject({ kind: 'outbox', userId: 'me' });
    expect(items[2]).toMatchObject({ kind: 'message', userId: 'u2' });
  });
  it('is just the history when nothing waits', () => {
    expect(threadItems(pages([msg('a', '01')]), [], 'me').map((i) => i.key)).toEqual(['msg-a']);
  });
});
