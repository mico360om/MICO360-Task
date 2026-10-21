import { describe, it, expect } from 'vitest';
import { rowIndexOf, threadRows, unreadAfterOf, type UploadEntry } from './chat-timeline';
import type { ThreadPages } from './chat-thread';
import type { OutboxEntry } from './chat-outbox';
import type { QueuedMutation } from './sync-queue';
import type { ApiChatMessage, ApiConversationSummary } from './types';

const msg = (id: string, at: string, over: Partial<ApiChatMessage> = {}): ApiChatMessage => ({
  id,
  conversationId: 'c1',
  userId: 'u2',
  body: id,
  editedAt: null,
  deletedAt: null,
  createdAt: at,
  reactions: [],
  attachments: [],
  ...over,
});
// The server's pages: the newest page first, each oldest message first.
const data = (...pages: ApiChatMessage[][]): ThreadPages => ({ pages, pageParams: pages.map(() => undefined) });
const NOW = new Date('2026-10-21T12:00:00.000Z');
const key = (r: ReturnType<typeof threadRows>[number]) => (r.type === 'message' ? r.message.id : r.type === 'day' ? `[${r.label}]` : '--unread--');

describe('the thread’s rows for the inverted list, newest first (3b)', () => {
  it('days, the unread line and the messages; the newest at the start (the bottom of the screen)', () => {
    const rows = threadRows({
      data: data([msg('c', '2026-10-21T09:00:00.000Z'), msg('d', '2026-10-21T09:10:00.000Z')], [msg('a', '2026-10-20T08:00:00.000Z'), msg('b', '2026-10-21T08:00:00.000Z')]),
      outbox: [],
      uploads: [],
      pending: [],
      myId: 'me',
      unreadAfter: '2026-10-21T08:30:00.000Z',
      now: NOW,
      timeZone: 'UTC',
    });
    expect(rows.map(key)).toEqual(['d', 'c', '--unread--', 'b', '[Today]', 'a', '[Yesterday]']);
  });

  it('messages still on the phone (and files on their way) come at the newest end, marked as waiting', () => {
    const entry: OutboxEntry = { queueId: 'q1', clientId: 'k1', conversationId: 'c1', body: 'mine', createdAt: '2026-10-21T09:20:00.000Z', state: 'failed', reason: 'No.' };
    const upload: UploadEntry = { key: 'up1', clientId: 'k2', conversationId: 'c1', name: 'plan.pdf', size: 2048, type: 'application/pdf', uri: 'file:///plan.pdf', progress: 0.5, state: 'sending', caption: '', replyTo: null, createdAt: '2026-10-21T09:21:00.000Z' };
    const rows = threadRows({ data: data([msg('a', '2026-10-21T09:00:00.000Z')]), outbox: [entry], uploads: [upload], pending: [], myId: 'me', unreadAfter: null, now: NOW, timeZone: 'UTC' });
    const shown = rows.filter((r) => r.type === 'message');
    expect(shown.map((r) => r.type === 'message' && [r.message.id, r.message.pending, r.message.userId])).toEqual([
      ['upload-up1', 'sending', 'me'],
      ['out-q1', 'failed', 'me'],
      ['a', undefined, 'u2'],
    ]);
    const out = shown[1]!;
    expect(out.type === 'message' && out.message.outbox).toBe(entry);
    expect(shown[0]!.type === 'message' && shown[0]!.message.upload).toBe(upload);
  });

  it('shows this phone’s waiting edits, deletions and reactions over the server’s copy', () => {
    const pending: QueuedMutation[] = [{ id: 'q', kind: 'chat.edit', payload: { conversationId: 'c1', messageId: 'a', body: 'fixed' }, createdAt: 0, userId: 'me', idempotencyKey: 'k', attempts: 0, status: 'pending' }];
    const rows = threadRows({ data: data([msg('a', '2026-10-21T09:00:00.000Z', { userId: 'me' })]), outbox: [], uploads: [], pending, myId: 'me', unreadAfter: null, now: NOW, timeZone: 'UTC' });
    const row = rows.find((r) => r.type === 'message');
    expect(row?.type === 'message' && row.message.body).toBe('fixed');
  });

  it('finds where a message is (to jump to it from a reply or a search), or -1 when it isn’t loaded', () => {
    const rows = threadRows({ data: data([msg('a', '2026-10-21T09:00:00.000Z'), msg('b', '2026-10-21T09:01:00.000Z')]), outbox: [], uploads: [], pending: [], myId: 'me', unreadAfter: null, now: NOW, timeZone: 'UTC' });
    expect(rowIndexOf(rows, 'a')).toBe(1);
    expect(rowIndexOf(rows, 'zz')).toBe(-1);
  });
});

describe('where the "unread" line goes (taken as the thread opens)', () => {
  const s = (over: Partial<ApiConversationSummary>): ApiConversationSummary => ({
    conversation: { id: 'c1', kind: 'DIRECT', projectId: null, createdAt: '' },
    participants: [{ conversationId: 'c1', userId: 'me', lastReadAt: '2026-10-21T08:00:00.000Z', addedAt: '' }],
    unread: 0,
    lastMessage: null,
    ...over,
  });
  it('after my last read when something is unread; nowhere when all is read', () => {
    expect(unreadAfterOf(s({ unread: 3 }), 'me')).toBe('2026-10-21T08:00:00.000Z');
    expect(unreadAfterOf(s({ unread: 3, participants: [] }), 'me')).toBe(new Date(0).toISOString());
    expect(unreadAfterOf(s({ unread: 0 }), 'me')).toBeNull();
    expect(unreadAfterOf(undefined, 'me')).toBeNull();
  });
});
