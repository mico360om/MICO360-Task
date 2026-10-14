import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildTimeline,
  inboxSections,
  receiptState,
  mergeMessages,
  validateAttachment,
  loadDraft,
  saveDraft,
  previewOf,
  needsDeliveryAck,
  highlightParts,
  searchSnippet,
  loadCollapsed,
  saveCollapsed,
  formatSize,
  loadOutbox,
  saveOutbox,
  type PendingMessage,
} from './chat-model';
import type { ApiMessage, ConversationSummary } from '../api/chat';

const msg = (over: Partial<ApiMessage>): ApiMessage => ({
  id: 'm', conversationId: 'c1', userId: 'u2', body: 'hi', editedAt: null, deletedAt: null, createdAt: '2026-10-10T08:00:00.000Z',
  reactions: [], attachments: [], replyTo: null, clientId: null, ...over,
});

describe('buildTimeline', () => {
  it('groups one sender’s messages within five minutes, splits days, and marks where unread starts', () => {
    const list = [
      msg({ id: 'a', userId: 'u2', createdAt: '2026-10-09T20:00:00.000Z' }),
      msg({ id: 'b', userId: 'u2', createdAt: '2026-10-10T08:00:00.000Z' }),
      msg({ id: 'c', userId: 'u2', createdAt: '2026-10-10T08:03:00.000Z' }),
      msg({ id: 'd', userId: 'me', createdAt: '2026-10-10T08:04:00.000Z' }),
      msg({ id: 'e', userId: 'u2', createdAt: '2026-10-10T08:30:00.000Z' }),
    ];
    const items = buildTimeline(list, { myId: 'me', unreadAfter: '2026-10-10T08:01:00.000Z', timeZone: 'UTC' });
    expect(items.map((i) => (i.type === 'message' ? `${i.message.id}${i.groupStart ? '^' : ''}${i.groupEnd ? '$' : ''}` : i.type))).toEqual([
      'day', 'a^$', 'day', 'b^', 'unread', 'c$', 'd^$', 'e^$',
    ]);
  });

  it('puts no unread line before your own messages, or when everything was read', () => {
    const list = [msg({ id: 'a', userId: 'me', createdAt: '2026-10-10T08:00:00.000Z' })];
    expect(buildTimeline(list, { myId: 'me', unreadAfter: '2026-10-10T07:00:00.000Z', timeZone: 'UTC' }).some((i) => i.type === 'unread')).toBe(false);
    expect(buildTimeline([msg({ id: 'b' })], { myId: 'me', unreadAfter: null, timeZone: 'UTC' }).some((i) => i.type === 'unread')).toBe(false);
  });
});

describe('inboxSections', () => {
  const summary = (over: Partial<ConversationSummary> & { id: string }): ConversationSummary => ({
    conversation: { id: over.id, kind: 'DIRECT', projectId: null, createdAt: '' },
    participants: [{ conversationId: over.id, userId: 'me', lastReadAt: null, addedAt: '', lastDeliveredAt: null }],
    unread: 0,
    lastMessage: null,
    prefs: { favorite: false, archived: false, muted: false },
    ...over,
  });
  const people: Record<string, string> = { u2: 'Omar Ahmed', u3: 'سارة البلوشي', u4: 'Main FLOW-A' };
  const base = {
    myId: 'me',
    nameOf: (id: string) => people[id] ?? 'Someone',
    projects: [
      { id: 'p1', name: 'Mobile App (Phase 2)' },
      { id: 'p2', name: 'Finance Automation' },
      { id: 'p3', name: 'مشروع الإطلاق' },
    ],
  };
  const inbox: ConversationSummary[] = [
    summary({ id: 'c-p1', conversation: { id: 'c-p1', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, unread: 3, lastMessage: msg({ body: 'Build is green', createdAt: '2026-10-10T09:00:00.000Z' }) }),
    summary({ id: 'c-p2', conversation: { id: 'c-p2', kind: 'PROJECT', projectId: 'p2', createdAt: '' }, prefs: { favorite: true, archived: false, muted: true } }),
    summary({ id: 'dm-2', participants: [{ conversationId: 'dm-2', userId: 'me', lastReadAt: null, addedAt: '', lastDeliveredAt: null }, { conversationId: 'dm-2', userId: 'u2', lastReadAt: null, addedAt: '', lastDeliveredAt: null }], lastMessage: msg({ createdAt: '2026-10-10T10:00:00.000Z' }) }),
    summary({ id: 'dm-3', participants: [{ conversationId: 'dm-3', userId: 'u3', lastReadAt: null, addedAt: '', lastDeliveredAt: null }], unread: 2, prefs: { favorite: false, archived: true, muted: false } }),
  ];

  it('splits favorites, channels (every project, opened or not), direct messages and archived', () => {
    const s = inboxSections({ ...base, inbox, query: '' });
    expect(s.favorites.map((r) => r.title)).toEqual(['Finance Automation']);
    expect(s.channels.map((r) => r.title)).toEqual(['Mobile App (Phase 2)', 'مشروع الإطلاق']);
    expect(s.channels[0]).toMatchObject({ conversationId: 'c-p1', unread: 3, projectId: 'p1' });
    expect(s.channels[1]).toMatchObject({ conversationId: null, unread: 0 });
    expect(s.directs.map((r) => [r.title, r.partnerId])).toEqual([['Omar Ahmed', 'u2']]);
    expect(s.archived.map((r) => r.title)).toEqual(['سارة البلوشي']);
    expect(s.archivedUnread).toBe(2);
    expect(s.favorites[0]!.prefs.muted).toBe(true);
  });

  it('filters by name in any language, case-insensitively', () => {
    expect(inboxSections({ ...base, inbox, query: 'omar' }).directs.map((r) => r.title)).toEqual(['Omar Ahmed']);
    expect(inboxSections({ ...base, inbox, query: 'omar' }).channels).toEqual([]);
    expect(inboxSections({ ...base, inbox, query: 'الإطلاق' }).channels.map((r) => r.title)).toEqual(['مشروع الإطلاق']);
    expect(inboxSections({ ...base, inbox, query: 'سارة' }).archived.map((r) => r.title)).toEqual(['سارة البلوشي']);
  });
});

describe('receiptState', () => {
  const mine = msg({ id: 'x', userId: 'me', createdAt: '2026-10-10T08:00:00.000Z' });
  const p = (userId: string, read: string | null, delivered: string | null) => ({ conversationId: 'c1', userId, lastReadAt: read, lastDeliveredAt: delivered, addedAt: '' });

  it('direct: sent → delivered → read, from the other person’s markers (or them being online)', () => {
    const ctx = (other: ReturnType<typeof p>, online = false) => ({ myId: 'me', kind: 'DIRECT' as const, participants: [p('me', null, null), other], isOnline: () => online });
    expect(receiptState(mine, ctx(p('u2', null, null))).status).toBe('sent');
    expect(receiptState(mine, ctx(p('u2', null, null), true)).status).toBe('delivered');
    expect(receiptState(mine, ctx(p('u2', null, '2026-10-10T08:00:01.000Z'))).status).toBe('delivered');
    expect(receiptState(mine, ctx(p('u2', '2026-10-10T08:05:00.000Z', null))).status).toBe('read');
  });

  it('channel: says how many have seen it', () => {
    const r = receiptState(mine, { myId: 'me', kind: 'PROJECT', participants: [p('me', null, null), p('u2', '2026-10-10T09:00:00.000Z', null), p('u3', '2026-10-10T07:00:00.000Z', null), p('u4', '2026-10-10T08:30:00.000Z', null)], isOnline: () => false });
    expect(r).toEqual({ status: 'read', seenBy: 2 });
  });

  it('messages still on their way say so', () => {
    const ctx = { myId: 'me', kind: 'DIRECT' as const, participants: [], isOnline: () => false };
    expect(receiptState({ ...mine, pending: 'sending' } as never, ctx).status).toBe('sending');
    expect(receiptState({ ...mine, pending: 'failed' } as never, ctx).status).toBe('failed');
    expect(receiptState({ ...mine, pending: 'queued' } as never, ctx).status).toBe('queued');
  });
});

describe('mergeMessages', () => {
  it('shows server pages oldest first, once each, with pending sends after them until the server has them', () => {
    const pages = [[msg({ id: 'n2', createdAt: '2026-10-10T09:00:00.000Z', clientId: 'k1' })], [msg({ id: 'o1', createdAt: '2026-10-10T07:00:00.000Z' }), msg({ id: 'n2', createdAt: '2026-10-10T09:00:00.000Z', clientId: 'k1' })]];
    const pending: PendingMessage[] = [
      { clientId: 'k1', conversationId: 'c1', body: 'already there', createdAt: '2026-10-10T09:00:00.000Z', state: 'sending', replyTo: null, files: [] },
      { clientId: 'k2', conversationId: 'c1', body: 'still sending', createdAt: '2026-10-10T09:01:00.000Z', state: 'sending', replyTo: null, files: [] },
    ];
    const out = mergeMessages(pages, pending, 'me');
    expect(out.map((m) => m.id)).toEqual(['o1', 'n2', 'pending-k2']);
    expect(out[2]).toMatchObject({ userId: 'me', body: 'still sending', pending: 'sending' });
  });
});

describe('validateAttachment', () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size }) as File;
  it('accepts what the server accepts, with a clear reason otherwise', () => {
    expect(validateAttachment(file('a.png', 'image/png', 1000))).toBeNull();
    expect(validateAttachment(file('brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000))).toBeNull();
    expect(validateAttachment(file('big.pdf', 'application/pdf', 11 * 1024 * 1024))).toMatch(/10 MB/);
    expect(validateAttachment(file('empty.txt', 'text/plain', 0))).toMatch(/empty/i);
    expect(validateAttachment(file('run.exe', 'application/x-msdownload', 100))).toMatch(/can’t be sent/);
  });
});

describe('drafts', () => {
  beforeEach(() => localStorage.clear());
  it('keeps a separate draft per conversation, and forgets it once empty', () => {
    saveDraft('c1', 'hello');
    saveDraft('c2', 'مرحبا');
    expect(loadDraft('c1')).toBe('hello');
    expect(loadDraft('c2')).toBe('مرحبا');
    saveDraft('c1', '   ');
    expect(loadDraft('c1')).toBe('');
  });
});

describe('previewOf — the sidebar’s one-line summary of the last message', () => {
  const nameOf = (id: string) => ({ u2: 'Ada Lovelace', u3: 'Grace Hopper' })[id] ?? 'Someone';
  it('says who wrote it in a channel, “You” for your own, and nothing extra in a direct conversation', () => {
    expect(previewOf(msg({ userId: 'u2', body: 'hello\n  team' }), { myId: 'me', kind: 'PROJECT', nameOf })).toBe('Ada: hello team');
    expect(previewOf(msg({ userId: 'me', body: 'done' }), { myId: 'me', kind: 'DIRECT', nameOf })).toBe('You: done');
    expect(previewOf(msg({ userId: 'u2', body: 'hi' }), { myId: 'me', kind: 'DIRECT', nameOf })).toBe('hi');
  });
  it('describes files and deleted messages instead of showing nothing', () => {
    const file = { id: 'a', messageId: 'm', fileName: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', createdAt: '', url: '/u' };
    expect(previewOf(msg({ userId: 'u2', body: '', attachments: [file] }), { myId: 'me', kind: 'DIRECT', nameOf })).toBe('📎 plan.pdf');
    expect(previewOf(msg({ userId: 'u2', body: '', deletedAt: '2026-10-10T09:00:00.000Z' }), { myId: 'me', kind: 'DIRECT', nameOf })).toBe('Message deleted');
    expect(previewOf(null, { myId: 'me', kind: 'DIRECT', nameOf })).toBe('');
  });
});

describe('needsDeliveryAck', () => {
  const dm = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
    conversation: { id: 'd1', kind: 'DIRECT', projectId: null, createdAt: '' },
    participants: [
      { conversationId: 'd1', userId: 'me', lastReadAt: null, lastDeliveredAt: null, addedAt: '' },
      { conversationId: 'd1', userId: 'u2', lastReadAt: null, lastDeliveredAt: null, addedAt: '' },
    ],
    unread: 1,
    lastMessage: msg({ userId: 'u2', createdAt: '2026-10-10T08:00:00.000Z' }),
    ...over,
  });
  it('acknowledges a direct message from the other person that this app has not confirmed yet', () => {
    expect(needsDeliveryAck(dm(), 'me')).toBe(true);
  });
  it('not for your own message, a channel, or one already delivered or read', () => {
    expect(needsDeliveryAck(dm({ lastMessage: msg({ userId: 'me' }) }), 'me')).toBe(false);
    expect(needsDeliveryAck(dm({ conversation: { id: 'c1', kind: 'PROJECT', projectId: 'p1', createdAt: '' } }), 'me')).toBe(false);
    const delivered = dm();
    delivered.participants[0]!.lastDeliveredAt = '2026-10-10T08:00:01.000Z';
    expect(needsDeliveryAck(delivered, 'me')).toBe(false);
    const read = dm();
    read.participants[0]!.lastReadAt = '2026-10-10T08:05:00.000Z';
    expect(needsDeliveryAck(read, 'me')).toBe(false);
    expect(needsDeliveryAck(dm({ lastMessage: null }), 'me')).toBe(false);
  });
});

describe('search results', () => {
  it('marks every match, whatever the case', () => {
    expect(highlightParts('Budget review: the BUDGET is ready', 'budget')).toEqual([
      { text: 'Budget', match: true }, { text: ' review: the ', match: false }, { text: 'BUDGET', match: true }, { text: ' is ready', match: false },
    ]);
    expect(highlightParts('no hits here', 'zzz')).toEqual([{ text: 'no hits here', match: false }]);
    expect(highlightParts('مرحبا بالفريق', 'الفريق')).toEqual([{ text: 'مرحبا ب', match: false }, { text: 'الفريق', match: true }]);
  });
  it('cuts a long message down to the part around the match', () => {
    const long = `${'a'.repeat(300)} the budget line ${'b'.repeat(300)}`;
    const s = searchSnippet(long, 'budget', 40);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('the budget line');
    expect(s.length).toBeLessThan(120);
    expect(searchSnippet('short budget', 'budget', 40)).toBe('short budget');
  });
});

describe('sidebar sections remember being collapsed', () => {
  beforeEach(() => localStorage.clear());
  it('stores which sections are closed (archived starts closed)', () => {
    expect(loadCollapsed()).toEqual({ archived: true });
    saveCollapsed({ archived: false, channels: true });
    expect(loadCollapsed()).toEqual({ archived: false, channels: true });
  });
});

describe('formatSize', () => {
  it('reads like a person would write it', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});

describe('outbox — messages not sent yet survive leaving the page', () => {
  beforeEach(() => localStorage.clear());
  const pending = (over: Partial<PendingMessage>): PendingMessage => ({
    clientId: 'k1', conversationId: 'c1', body: 'later', createdAt: '2026-10-10T08:00:00.000Z', state: 'queued', replyTo: null, files: [], ...over,
  });
  it('keeps text messages that are waiting, sending or failed — per person — and comes back with them waiting', () => {
    saveOutbox('me', [pending({ clientId: 'a', state: 'sending' }), pending({ clientId: 'b', state: 'failed', error: 'Too long.' }), pending({ clientId: 'c', files: [{ name: 'x.png', size: 1, type: 'image/png', progress: 0 }] })]);
    const back = loadOutbox('me');
    expect(back.map((p) => [p.clientId, p.state])).toEqual([['a', 'queued'], ['b', 'failed']]);
    expect(loadOutbox('someone-else')).toEqual([]);
  });
  it('forgets the outbox once it is empty, and ignores anything unreadable', () => {
    saveOutbox('me', [pending({})]);
    saveOutbox('me', []);
    expect(Object.keys(localStorage)).toEqual([]);
    localStorage.setItem('mico360.chat.outbox.me', '{not json');
    expect(loadOutbox('me')).toEqual([]);
  });
});
