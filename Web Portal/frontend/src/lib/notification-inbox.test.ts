import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NOTIFICATION_KINDS,
  parseInboxFilter,
  serializeInboxFilter,
  toggleKind,
  unreadInView,
  groupByDay,
  emptyInbox,
  chunks,
  newestCreatedAt,
} from './notification-inbox';

describe('the type chips', () => {
  it('six, in order, with their labels', () => {
    expect(NOTIFICATION_KINDS.map((k) => [k.key, k.label])).toEqual([
      ['mentions', 'Mentions'],
      ['assigned', 'Assigned to me'],
      ['due', 'Due & overdue'],
      ['comments', 'Comments'],
      ['approvals', 'Approvals'],
      ['meetings', 'Meetings'],
    ]);
  });

  const server = resolve(__dirname, '../../../backend/src/modules/notifications/notification-kinds.ts');
  it.skipIf(!existsSync(server))('the same chips as the server’s (notifications/notification-kinds.ts)', () => {
    const src = readFileSync(server, 'utf8');
    const block = /NOTIFICATION_KINDS = \{([\s\S]*?)\} as const/.exec(src)?.[1] ?? '';
    expect([...block.matchAll(/^\s+(\w+): \[/gm)].map((m) => m[1])).toEqual(NOTIFICATION_KINDS.map((k) => k.key));
  });

  it('a chip turns on and off; the chips stay in their order', () => {
    expect(toggleKind([], 'due')).toEqual(['due']);
    expect(toggleKind(['due'], 'mentions')).toEqual(['mentions', 'due']);
    expect(toggleKind(['mentions', 'due'], 'mentions')).toEqual(['due']);
  });
});

describe('the remembered tab and chips (this browser, per person)', () => {
  it('round-trips', () => {
    const f = { tab: 'unread' as const, kinds: ['mentions' as const, 'meetings' as const] };
    expect(parseInboxFilter(serializeInboxFilter(f))).toEqual(f);
  });

  it('nothing saved, or something unreadable or out of date: All, every type', () => {
    for (const raw of [null, '', 'not json', '{"tab":"starred"}', '[]', '{"tab":"unread","kinds":"due"}']) {
      const f = parseInboxFilter(raw);
      expect(f.kinds, String(raw)).toEqual([]);
    }
    expect(parseInboxFilter('{"tab":"unread","kinds":["due","gone"]}')).toEqual({ tab: 'unread', kinds: ['due'] });
    expect(parseInboxFilter(null).tab).toBe('all');
  });
});

describe('“Unread (12)”: unread in the chips chosen', () => {
  const counts = { unread: 12, kinds: { mentions: 3, assigned: 2, due: 4, comments: 0, approvals: 1, meetings: 0 } };
  it('no chip: every unread one; chips: theirs added up', () => {
    expect(unreadInView(counts, [])).toBe(12);
    expect(unreadInView(counts, ['mentions', 'due'])).toBe(7);
    expect(unreadInView(undefined, [])).toBeNull();
  });
});

describe('grouped by day, in the person’s time zone', () => {
  const now = new Date('2026-11-04T07:00:00Z'); // Wed 4 Nov, 11:00 in Muscat
  const rows = [
    { id: 'a', createdAt: '2026-11-04T05:05:00Z' },
    { id: 'b', createdAt: '2026-11-03T20:30:00Z' }, // 00:30 on 4 Nov in Muscat
    { id: 'c', createdAt: '2026-11-03T09:00:00Z' },
    { id: 'd', createdAt: '2026-11-02T09:00:00Z' },
    { id: 'e', createdAt: '2025-12-31T09:00:00Z' },
  ];

  it('Today, Yesterday, then “Mon 2 Nov”; another year says its year', () => {
    const groups = groupByDay(rows, 'Asia/Muscat', now);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Mon 2 Nov', ['d']],
      ['Wed 31 Dec 2025', ['e']],
    ]);
    expect(groups[2]!.key).toBe('2026-11-02');
  });

  it('the day turns at midnight where the person is, not where the server is', () => {
    expect(groupByDay([rows[1]!], 'UTC', now).map((g) => g.label)).toEqual(['Yesterday']);
  });
});

describe('an empty list says what is empty, and how to see more', () => {
  it('per tab and chip', () => {
    expect(emptyInbox({ tab: 'unread', kinds: [] })).toEqual({ title: 'No unread notifications', description: 'You’ve read them all.', clear: 'tab' });
    expect(emptyInbox({ tab: 'all', kinds: ['mentions'] })).toMatchObject({ title: 'No mentions', clear: 'kinds' });
    expect(emptyInbox({ tab: 'unread', kinds: ['due'] })).toMatchObject({ title: 'No unread due or overdue reminders', clear: 'kinds' });
    expect(emptyInbox({ tab: 'all', kinds: ['assigned', 'meetings'] })).toMatchObject({ title: 'No notifications of these types', clear: 'kinds' });
    expect(emptyInbox({ tab: 'unread', kinds: ['assigned', 'meetings'] })).toMatchObject({ title: 'No unread notifications of these types', clear: 'kinds' });
    expect(emptyInbox({ tab: 'all', kinds: [] })).toMatchObject({ title: 'You’re all caught up', clear: null });
  });
});

describe('helpers', () => {
  it('several at once go 200 to a request', () => {
    expect(chunks(Array.from({ length: 450 }, (_, i) => i)).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunks([])).toEqual([]);
  });

  it('the newest shown (for Mark all read)', () => {
    expect(newestCreatedAt([{ createdAt: '2026-11-03T09:00:00.000Z' }, { createdAt: '2026-11-04T09:00:00.000Z' }])).toBe('2026-11-04T09:00:00.000Z');
    expect(newestCreatedAt([])).toBeUndefined();
  });
});
