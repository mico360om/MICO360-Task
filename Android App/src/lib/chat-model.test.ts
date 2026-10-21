import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALLOWED_TYPES,
  buildTimeline,
  dayLabel,
  formatSize,
  highlightParts,
  inboxSections,
  lastActiveLabel,
  MAX_UPLOAD_BYTES,
  needsDeliveryAck,
  presenceReducer,
  previewOf,
  receiptState,
  searchSnippet,
  validateAttachment,
  type PresenceEvent,
  type ShownMessage,
} from './chat-model';
import type { ApiConversationSummary } from './types';

const msg = (id: string, at: string, over: Partial<ShownMessage> = {}): ShownMessage => ({
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
const NOW = new Date('2026-10-21T12:00:00.000Z');
const summary = (id: string, over: Partial<ApiConversationSummary> = {}): ApiConversationSummary => ({
  conversation: { id, kind: 'DIRECT', projectId: null, createdAt: '2026-10-01T00:00:00.000Z' },
  participants: [
    { conversationId: id, userId: 'me', lastReadAt: null, addedAt: '' },
    { conversationId: id, userId: 'u2', lastReadAt: null, addedAt: '' },
  ],
  unread: 0,
  lastMessage: null,
  ...over,
});

describe('the thread’s days, groups and unread line (3b, 3a review #3)', () => {
  it('puts a day line before each day, an "unread" line before the first new message from someone else, and groups one sender’s run', () => {
    const items = buildTimeline(
      [
        msg('a', '2026-10-20T09:00:00.000Z'),
        msg('b', '2026-10-21T08:00:00.000Z'),
        msg('c', '2026-10-21T08:02:00.000Z'),
        msg('mine', '2026-10-21T08:03:00.000Z', { userId: 'me' }),
        msg('d', '2026-10-21T08:30:00.000Z'),
      ],
      { myId: 'me', unreadAfter: '2026-10-21T08:01:00.000Z', timeZone: 'UTC', now: NOW },
    );
    expect(items.map((i) => (i.type === 'message' ? `${i.message.id}${i.groupStart ? '^' : ''}${i.groupEnd ? '$' : ''}` : i.type === 'day' ? `[${i.label}]` : '--unread--'))).toEqual([
      '[Yesterday]',
      'a^$',
      '[Today]',
      'b^',
      '--unread--',
      'c$',
      'mine^$',
      'd^$',
    ]);
  });
  it('labels other days by weekday and date, and a past year with the year', () => {
    expect(dayLabel('2026-10-15T09:00:00.000Z', NOW, 'UTC')).toMatch(/Oct/);
    expect(dayLabel('2025-03-02T09:00:00.000Z', NOW, 'UTC')).toMatch(/2025/);
  });
});

describe('the conversation list’s sections (3b)', () => {
  it('favorites first, then project channels (opened or not), direct messages, and the archive apart', () => {
    const inbox = [
      summary('d1', { lastMessage: { id: 'm1', conversationId: 'd1', userId: 'u2', body: 'hi', editedAt: null, deletedAt: null, createdAt: '2026-10-21T10:00:00.000Z' } }),
      summary('d2', { prefs: { favorite: true, archived: false, muted: false } }),
      summary('d3', { unread: 4, prefs: { favorite: false, archived: true, muted: false }, participants: [{ conversationId: 'd3', userId: 'u3', lastReadAt: null, addedAt: '' }] }),
      { ...summary('ch1'), conversation: { id: 'ch1', kind: 'PROJECT' as const, projectId: 'p1', createdAt: '' } },
    ];
    const s = inboxSections({ inbox, projects: [{ id: 'p1', name: 'Falcon' }, { id: 'p2', name: 'Atlas' }], myId: 'me', nameOf: (id) => ({ u2: 'Sara Ali', u3: 'Omar' })[id] ?? 'Someone', query: '' });
    expect(s.favorites.map((r) => r.key)).toEqual(['d-d2']);
    expect(s.channels.map((r) => [r.title, r.conversationId])).toEqual([
      ['Atlas', null],
      ['Falcon', 'ch1'],
    ]);
    expect(s.directs.map((r) => r.key)).toEqual(['d-d1']);
    expect(s.archived.map((r) => r.key)).toEqual(['d-d3']);
    expect(s.archivedUnread).toBe(4);
    expect(inboxSections({ inbox, projects: [], myId: 'me', nameOf: () => 'Sara Ali', query: 'sar' }).directs.map((r) => r.key)).toEqual(['d-d1']);
  });
});

describe('where my message stands (receipts, 3b)', () => {
  const ctx = (participants: ApiConversationSummary['participants'], kind: 'DIRECT' | 'PROJECT' = 'DIRECT', online: string[] = []) => ({ myId: 'me', kind, participants, isOnline: (id: string) => online.includes(id) });
  const mine = msg('m', '2026-10-21T10:00:00.000Z', { userId: 'me' });
  it('direct: read once they read past it, delivered once their app got it (or they are online), else sent', () => {
    const p = (over: object) => [{ conversationId: 'c1', userId: 'me', lastReadAt: null, addedAt: '' }, { conversationId: 'c1', userId: 'u2', lastReadAt: null, addedAt: '', ...over }];
    expect(receiptState(mine, ctx(p({ lastReadAt: '2026-10-21T10:05:00.000Z' })))).toEqual({ status: 'read' });
    expect(receiptState(mine, ctx(p({ lastDeliveredAt: '2026-10-21T10:01:00.000Z' })))).toEqual({ status: 'delivered' });
    expect(receiptState(mine, ctx(p({}), 'DIRECT', ['u2']))).toEqual({ status: 'delivered' });
    expect(receiptState(mine, ctx(p({})))).toEqual({ status: 'sent' });
  });
  it('a channel: how many have seen it', () => {
    const p = [
      { conversationId: 'c1', userId: 'u2', lastReadAt: '2026-10-21T10:05:00.000Z', addedAt: '' },
      { conversationId: 'c1', userId: 'u3', lastReadAt: '2026-10-21T10:06:00.000Z', addedAt: '' },
      { conversationId: 'c1', userId: 'u4', lastReadAt: '2026-10-21T09:00:00.000Z', addedAt: '' },
    ];
    expect(receiptState(mine, ctx(p, 'PROJECT'))).toEqual({ status: 'read', seenBy: 2 });
  });
});

describe('a conversation’s last message in the list, and telling the server a message arrived (3b)', () => {
  it('previews who wrote it in a channel, "You:" for mine, and what a file or a deleted message was', () => {
    const last = { id: 'm', conversationId: 'c', userId: 'u2', body: 'Hello\nteam', editedAt: null, deletedAt: null, createdAt: '' };
    expect(previewOf(last, { myId: 'me', kind: 'PROJECT', nameOf: () => 'Sara Ali' })).toBe('Sara: Hello team');
    expect(previewOf({ ...last, userId: 'me' }, { myId: 'me', kind: 'DIRECT', nameOf: () => 'x' })).toBe('You: Hello team');
    expect(previewOf({ ...last, deletedAt: 'x' }, { myId: 'me', kind: 'DIRECT', nameOf: () => 'x' })).toBe('Message deleted');
    expect(previewOf({ ...last, body: '', attachments: [{ id: 'a', messageId: 'm', fileName: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', createdAt: '', url: '/u' }] }, { myId: 'me', kind: 'DIRECT', nameOf: () => 'x' })).toBe('📎 plan.pdf');
  });
  it('acks a direct message from the other person that this phone hasn’t confirmed or read yet', () => {
    const s = summary('d1', { lastMessage: { id: 'm1', conversationId: 'd1', userId: 'u2', body: 'hi', editedAt: null, deletedAt: null, createdAt: '2026-10-21T10:00:00.000Z' } });
    expect(needsDeliveryAck(s, 'me')).toBe(true);
    expect(needsDeliveryAck({ ...s, participants: [{ conversationId: 'd1', userId: 'me', lastReadAt: null, addedAt: '', lastDeliveredAt: '2026-10-21T10:00:00.000Z' }] }, 'me')).toBe(false);
    expect(needsDeliveryAck({ ...s, lastMessage: { ...s.lastMessage!, userId: 'me' } }, 'me')).toBe(false);
  });
});

describe('search results, files and presence (3b)', () => {
  it('marks the words found, and cuts a long message around them', () => {
    expect(highlightParts('Budget review today', 'review')).toEqual([
      { text: 'Budget ', match: false },
      { text: 'review', match: true },
      { text: ' today', match: false },
    ]);
    const long = `${'a '.repeat(80)}needle${' b'.repeat(80)}`;
    const cut = searchSnippet(long, 'needle');
    expect(cut.startsWith('…')).toBe(true);
    expect(cut).toContain('needle');
    expect(cut.length).toBeLessThan(long.length);
  });
  it('checks a file the way the server does: not empty, at most 10 MB, a type it takes', () => {
    expect(validateAttachment({ name: 'a.png', size: 0, type: 'image/png' })).toBe('“a.png” is empty.');
    expect(validateAttachment({ name: 'big.pdf', size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf' })).toBe('“big.pdf” is 10 MB — files can be up to 10 MB.');
    expect(validateAttachment({ name: 'x.exe', size: 10, type: 'application/x-msdownload' })).toBe(
      '“x.exe” can’t be sent: only pictures, PDFs, text, CSV, ZIP and Word / Excel / PowerPoint files are allowed.',
    );
    expect(validateAttachment({ name: 'ok.jpg', size: 10, type: 'image/jpeg' })).toBeNull();
    expect(formatSize(2048)).toBe('2 KB');
  });
  it('says when someone was last active, and follows who is online', () => {
    expect(lastActiveLabel(null, true, NOW)).toBe('Active now');
    expect(lastActiveLabel(null, false, NOW)).toBe('Offline');
    expect(lastActiveLabel('2026-10-21T11:50:00.000Z', false, NOW)).toBe('Last active 10m ago');
    const online = presenceReducer(new Set(['a']), { type: 'online', userId: 'b' });
    expect([...online].sort()).toEqual(['a', 'b']);
    expect([...presenceReducer(online, { type: 'offline', userId: 'a' })]).toEqual(['b']);
    expect([...presenceReducer(online, { type: 'state', userIds: ['z'] })]).toEqual(['z']);
  });
});

/** The website's chat logic and this copy must give the same answers. Skipped when the website isn't next to the app. */
const webModel = resolve(__dirname, '../../../Web Portal/frontend/src/lib/chat-model.ts');
const webLastActive = resolve(__dirname, '../../../Web Portal/frontend/src/lib/lastActive.ts');
const webPresence = resolve(__dirname, '../../../Web Portal/frontend/src/lib/presence.ts');
describe.skipIf(!existsSync(webModel))('the same as the website', () => {
  it('builds the same timeline, sections, receipts, previews, acks, highlights, snippets and file checks', async () => {
    const w = (await import(/* @vite-ignore */ webModel)) as Record<string, (...a: unknown[]) => unknown>;
    const messages = [
      msg('a', '2026-10-19T09:00:00.000Z'),
      msg('b', '2026-10-21T08:00:00.000Z'),
      msg('c', '2026-10-21T08:02:00.000Z'),
      msg('mine', '2026-10-21T08:03:00.000Z', { userId: 'me' }),
      msg('d', '2026-10-21T09:30:00.000Z'),
    ];
    for (const unreadAfter of [null, '2026-10-21T08:01:00.000Z', '2026-01-01T00:00:00.000Z']) {
      const opts = { myId: 'me', unreadAfter, timeZone: 'UTC', now: NOW };
      expect(buildTimeline(messages, opts)).toEqual(w.buildTimeline!(messages, opts));
    }
    const inbox = [
      summary('d1', { unread: 2 }),
      summary('d2', { prefs: { favorite: true, archived: false, muted: true } }),
      summary('d3', { prefs: { favorite: false, archived: true, muted: false } }),
      { ...summary('ch1'), conversation: { id: 'ch1', kind: 'PROJECT' as const, projectId: 'p1', createdAt: '' } },
    ];
    for (const query of ['', 'fal', 'zz']) {
      const input = { inbox, projects: [{ id: 'p1', name: 'Falcon' }, { id: 'p2', name: 'Atlas' }], myId: 'me', nameOf: () => 'Sara', query };
      expect(inboxSections(input)).toEqual(w.inboxSections!(input));
    }
    const mine = msg('m', '2026-10-21T10:00:00.000Z', { userId: 'me' });
    const parts = [{ conversationId: 'c1', userId: 'u2', lastReadAt: '2026-10-21T10:05:00.000Z', addedAt: '', lastDeliveredAt: null }];
    for (const kind of ['DIRECT', 'PROJECT'] as const) {
      const ctx = { myId: 'me', kind, participants: parts, isOnline: () => false };
      expect(receiptState(mine, ctx)).toEqual(w.receiptState!(mine, ctx));
    }
    const last = { id: 'm', conversationId: 'c', userId: 'u2', body: '  Hi\nthere ', editedAt: null, deletedAt: null, createdAt: '' };
    for (const kind of ['DIRECT', 'PROJECT'] as const) expect(previewOf(last, { myId: 'me', kind, nameOf: () => 'Sara Ali' })).toBe(w.previewOf!(last, { myId: 'me', kind, nameOf: () => 'Sara Ali' }));
    for (const s of inbox) expect(needsDeliveryAck(s, 'me')).toBe(w.needsDeliveryAck!(s, 'me'));
    for (const [t, q] of [['Budget review', 'REVIEW'], ['nothing', 'x'], ['', 'a']]) expect(highlightParts(t!, q!)).toEqual(w.highlightParts!(t, q));
    const long = `${'word '.repeat(60)}needle ${'more '.repeat(60)}`;
    expect(searchSnippet(long, 'needle')).toBe(w.searchSnippet!(long, 'needle'));
    for (const f of [{ name: 'a', size: 0, type: 'image/png' }, { name: 'b', size: 11 * 1024 * 1024, type: 'image/png' }, { name: 'c', size: 5, type: 'x/y' }, { name: 'd', size: 5, type: 'text/csv' }]) {
      expect(validateAttachment(f)).toBe(w.validateAttachment!(f));
    }
    for (const n of [12, 2048, 3.5 * 1024 * 1024]) expect(formatSize(n)).toBe(w.formatSize!(n));
    for (const iso of ['2026-10-21T09:00:00.000Z', '2026-10-20T09:00:00.000Z', '2026-10-14T09:00:00.000Z', '2025-02-02T09:00:00.000Z']) expect(dayLabel(iso, NOW, 'UTC')).toBe(w.dayLabel!(iso, NOW, 'UTC'));
  });

  it('tells the server a message arrived in the same cases, and allows the same files (3b review fix 6)', async () => {
    const w = (await import(/* @vite-ignore */ webModel)) as Record<string, unknown> & {
      needsDeliveryAck: typeof needsDeliveryAck;
      validateAttachment: typeof validateAttachment;
      ALLOWED_TYPES: Set<string>;
      MAX_UPLOAD_BYTES: number;
    };
    const at = '2026-10-21T10:00:00.000Z';
    const before = '2026-10-21T09:00:00.000Z';
    const after = '2026-10-21T11:00:00.000Z';
    const fromThem = { id: 'm', conversationId: 'd', userId: 'u2', body: 'Hi', editedAt: null, deletedAt: null, createdAt: at };
    const me = (over: object) => ({ conversationId: 'd', userId: 'me', lastReadAt: null, addedAt: '', lastDeliveredAt: null, ...over });
    const them = { conversationId: 'd', userId: 'u2', lastReadAt: null, addedAt: '' };
    const cases: ApiConversationSummary[] = [
      summary('d', { lastMessage: fromThem }), // not yet delivered: yes
      summary('d', { lastMessage: { ...fromThem, userId: 'me' } }), // mine: no
      summary('d', { lastMessage: { ...fromThem, deletedAt: after } }), // deleted: no
      summary('d', { lastMessage: fromThem, participants: [me({ lastDeliveredAt: after }), them] }), // delivered since: no
      summary('d', { lastMessage: fromThem, participants: [me({ lastDeliveredAt: before }), them] }), // delivered before it: yes
      summary('d', { lastMessage: fromThem, participants: [me({ lastReadAt: after }), them] }), // read since: no
      summary('d', { lastMessage: fromThem, participants: [me({ lastReadAt: before }), them] }), // read before it: yes
      summary('d', { lastMessage: fromThem, participants: [me({ lastDeliveredAt: at }), them] }), // delivered at that moment: no
      { ...summary('p', { lastMessage: fromThem }), conversation: { id: 'p', kind: 'PROJECT' as const, projectId: 'p1', createdAt: '' } }, // a channel: no
      summary('d', { lastMessage: fromThem, participants: [them] }), // no row for me: yes
    ];
    expect(cases.map((s) => needsDeliveryAck(s, 'me'))).toEqual(cases.map((s) => w.needsDeliveryAck(s, 'me')));
    expect(cases.map((s) => needsDeliveryAck(s, 'me'))).toEqual([true, false, false, false, true, false, true, false, false, true]);
    // The same types and limit, compared directly.
    expect([...ALLOWED_TYPES].sort()).toEqual([...w.ALLOWED_TYPES].sort());
    expect(MAX_UPLOAD_BYTES).toBe(w.MAX_UPLOAD_BYTES);
    for (const type of [...ALLOWED_TYPES, 'image/svg+xml', 'text/html', 'application/octet-stream', '']) {
      for (const size of [0, 1, MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES + 1]) {
        const f = { name: 'f', size, type };
        expect(validateAttachment(f), `${type} ${size}`).toBe(w.validateAttachment(f));
      }
    }
  });

  it('says last active and follows presence the same way', async () => {
    const la = (await import(/* @vite-ignore */ webLastActive)) as { lastActiveLabel: typeof lastActiveLabel };
    for (const [at, on] of [[null, true], [null, false], ['2026-10-21T11:59:50.000Z', false], ['2026-10-21T11:00:00.000Z', false], ['2026-10-20T10:00:00.000Z', false], ['2026-09-01T10:00:00.000Z', false]] as const) {
      expect(lastActiveLabel(at, on, NOW)).toBe(la.lastActiveLabel(at, on, NOW));
    }
    const pr = (await import(/* @vite-ignore */ webPresence)) as { presenceReducer: typeof presenceReducer };
    const s = new Set(['a']);
    const events: PresenceEvent[] = [{ type: 'online', userId: 'b' }, { type: 'offline', userId: 'a' }, { type: 'state', userIds: ['q', 'r'] }];
    for (const ev of events) {
      expect([...presenceReducer(s, ev)]).toEqual([...pr.presenceReducer(s, ev)]);
    }
  });
});
