import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DATE_RANGES,
  EMPTY_FILTERS,
  filterChips,
  filterMeetings,
  groupMeetings,
  hasActiveFilters,
  isUnderWay,
  meetingCardLabel,
  meetingListRows,
  nextUpMeeting,
  startsLabel,
  withoutOldMeetings,
  type ListContext,
  type MeetingFilters,
  type MeetingSort,
} from './meeting-list';
import type { ApiMeeting } from './types';

const m = (over: Partial<ApiMeeting>): ApiMeeting => ({
  id: 'x',
  title: 'Meeting',
  description: null,
  category: null,
  status: 'SCHEDULED',
  projectId: null,
  organizerId: 'u1',
  location: null,
  onlineLink: null,
  startAt: '2026-10-10T06:00:00.000Z',
  endAt: null,
  timeZone: null,
  recurrenceRule: null,
  recurrenceParentId: null,
  createdById: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

// 10 Oct 2026, 09:00 in Muscat (UTC+4).
const ctx: ListContext = {
  timeZone: 'Asia/Muscat',
  now: new Date('2026-10-10T05:00:00.000Z'),
  projectName: (id) => ({ p1: 'Falcon CRM' } as Record<string, string>)[id] ?? null,
  organizerName: (id) => ({ u1: 'Aisha Khan', u2: 'Omar Said' } as Record<string, string>)[id] ?? null,
};

const list = [
  m({ id: 'today-late', title: 'Budget review', startAt: '2026-10-10T12:00:00.000Z', projectId: 'p1' }),
  m({ id: 'today-early', title: 'Stand-up', startAt: '2026-10-10T04:30:00.000Z', endAt: '2026-10-10T05:30:00.000Z' }),
  // 22:30 UTC on the 9th is 02:30 on the 10th in Muscat: still today there.
  m({ id: 'today-night', title: 'Night shift handover', startAt: '2026-10-09T22:30:00.000Z', category: 'Operations' }),
  m({ id: 'soon', title: 'اجتماع الميزانية', startAt: '2026-10-12T06:00:00.000Z', organizerId: 'u2', location: 'Room B' }),
  m({ id: 'later', title: 'Quarterly planning', startAt: '2026-11-02T06:00:00.000Z' }),
  m({ id: 'yesterday', title: 'Retro', startAt: '2026-10-09T10:00:00.000Z', status: 'COMPLETED' }),
  m({ id: 'last-month', title: 'Kick-off', startAt: '2026-09-01T06:00:00.000Z', status: 'COMPLETED', updatedAt: '2026-10-09T00:00:00.000Z' }),
  m({ id: 'draft', title: 'Draft: hiring plan', startAt: '2026-10-20T06:00:00.000Z', status: 'DRAFT' }),
  m({ id: 'cancelled', title: 'Vendor call', startAt: '2026-10-11T06:00:00.000Z', status: 'CANCELLED' }),
];
const ids = (ms: ApiMeeting[]) => ms.map((x) => x.id);
const f = (over: Partial<MeetingFilters>): MeetingFilters => ({ ...EMPTY_FILTERS, ...over });

describe('groupMeetings', () => {
  it('groups into Today, Next 7 days, Later, Drafts and Past in the company’s time zone', () => {
    const groups = groupMeetings(list, ctx, 'date');
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['today', 'Today'],
      ['next7', 'Next 7 days'],
      ['later', 'Later'],
      ['drafts', 'Drafts'],
      ['past', 'Past'],
    ]);
    const by = Object.fromEntries(groups.map((g) => [g.key, ids(g.items)]));
    // Today and what's coming read soonest first; Past most recent first.
    expect(by.today).toEqual(['today-night', 'today-early', 'today-late']);
    expect(by.next7).toEqual(['cancelled', 'soon']);
    expect(by.later).toEqual(['later']);
    expect(by.drafts).toEqual(['draft']);
    expect(by.past).toEqual(['yesterday', 'last-month']);
  });

  it('counts the seventh day ahead in Next 7 days, and the eighth in Later', () => {
    const groups = groupMeetings([m({ id: 'd7', startAt: '2026-10-17T06:00:00.000Z' }), m({ id: 'd8', startAt: '2026-10-18T06:00:00.000Z' })], ctx, 'date');
    expect(groups.map((g) => [g.key, ids(g.items)])).toEqual([
      ['next7', ['d7']],
      ['later', ['d8']],
    ]);
  });

  it('sorts by title or by the latest change when asked, and leaves out empty groups', () => {
    expect(ids(groupMeetings(list, ctx, 'title')[0]!.items)).toEqual(['today-late', 'today-night', 'today-early']);
    expect(ids(groupMeetings(list, ctx, 'updated').find((g) => g.key === 'past')!.items)).toEqual(['last-month', 'yesterday']);
    expect(groupMeetings([list[5]!], ctx, 'date').map((g) => g.key)).toEqual(['past']);
  });
});

describe('filterMeetings', () => {
  it('searches the title, place, category, project and organizer, any case and Arabic too', () => {
    expect(ids(filterMeetings(list, f({ q: 'falcon' }), ctx))).toEqual(['today-late']);
    expect(ids(filterMeetings(list, f({ q: 'room b' }), ctx))).toEqual(['soon']);
    expect(ids(filterMeetings(list, f({ q: 'omar' }), ctx))).toEqual(['soon']);
    expect(ids(filterMeetings(list, f({ q: 'operations' }), ctx))).toEqual(['today-night']);
    expect(ids(filterMeetings(list, f({ q: 'الميزانية' }), ctx))).toEqual(['soon']);
    expect(filterMeetings(list, f({ q: '   ' }), ctx)).toHaveLength(list.length);
  });

  it('keeps one project, or only the meetings without one', () => {
    expect(ids(filterMeetings(list, f({ projectId: 'p1' }), ctx))).toEqual(['today-late']);
    expect(filterMeetings(list, f({ projectId: 'none' }), ctx).map((x) => x.projectId).every((p) => p === null)).toBe(true);
  });

  it('keeps one status, and the dates of a preset (company days)', () => {
    expect(ids(filterMeetings(list, f({ status: 'COMPLETED' }), ctx))).toEqual(['yesterday', 'last-month']);
    expect(ids(filterMeetings(list, f({ range: 'today' }), ctx))).toEqual(['today-late', 'today-early', 'today-night']);
    expect(ids(filterMeetings(list, f({ range: 'next7' }), ctx))).toEqual(['today-late', 'today-early', 'today-night', 'soon', 'cancelled']);
    expect(ids(filterMeetings(list, f({ range: 'last7' }), ctx))).toEqual(['today-late', 'today-early', 'today-night', 'yesterday']);
    expect(ids(filterMeetings(list, f({ range: 'month' }), ctx))).toContain('draft');
    expect(ids(filterMeetings(list, f({ range: 'last30' }), ctx))).not.toContain('last-month');
  });

  it('offers the date presets a phone can pick without typing a date', () => {
    expect(DATE_RANGES.map((r) => r.value)).toEqual(['any', 'today', 'next7', 'last7', 'month', 'last30']);
  });
});

describe('hasActiveFilters and filterChips', () => {
  it('counts the search, project, status and date as filters', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(f({ q: 'x' }))).toBe(true);
    expect(hasActiveFilters(f({ status: 'DRAFT' }))).toBe(true);
  });

  it('names each filter in use (and a sort other than by date) so it can be removed', () => {
    expect(filterChips(f({ projectId: 'p1', range: 'next7', status: 'IN_PROGRESS' }), 'title', ctx)).toEqual([
      { key: 'project', label: 'Project: Falcon CRM' },
      { key: 'date', label: 'Date: Next 7 days' },
      { key: 'status', label: 'Status: In Progress' },
      { key: 'sort', label: 'Sorted by title' },
    ]);
    expect(filterChips(f({ projectId: 'none' }), 'updated', ctx)).toEqual([
      { key: 'project', label: 'Standalone meetings only' },
      { key: 'sort', label: 'Recently updated first' },
    ]);
  });
});

describe('Up next', () => {
  const now = new Date('2026-10-10T05:00:00.000Z');

  it('is the meeting under way (started, not ended; an hour without an end), else the soonest scheduled one', () => {
    expect(isUnderWay(list[1]!, now)).toBe(true);
    expect(isUnderWay(m({ startAt: '2026-10-10T04:30:00.000Z' }), now)).toBe(true);
    expect(isUnderWay(m({ startAt: '2026-10-10T03:30:00.000Z' }), now)).toBe(false);
    expect(isUnderWay(m({ status: 'IN_PROGRESS', startAt: '2026-10-01T00:00:00.000Z' }), now)).toBe(true);
    expect(nextUpMeeting(list, now)?.id).toBe('today-early');
    expect(nextUpMeeting(list.filter((x) => x.id !== 'today-early'), now)?.id).toBe('today-late');
  });

  it('is never a draft, a cancelled or a finished meeting', () => {
    expect(nextUpMeeting([list[5]!, list[7]!, list[8]!], now)).toBeNull();
  });

  it('says when it starts, from now', () => {
    expect(startsLabel(list[1]!, now, 'Asia/Muscat')).toBe('Happening now');
    expect(startsLabel(m({ startAt: '2026-10-10T05:25:00.000Z' }), now, 'Asia/Muscat')).toBe('in 25 min');
    expect(startsLabel(m({ startAt: '2026-10-10T12:00:00.000Z' }), now, 'Asia/Muscat')).toBe('Today at 16:00');
    expect(startsLabel(m({ startAt: '2026-10-11T06:00:00.000Z' }), now, 'Asia/Muscat')).toBe('Tomorrow at 10:00');
    expect(startsLabel(m({ startAt: '2026-10-13T06:00:00.000Z' }), now, 'Asia/Muscat')).toBe('Tuesday at 10:00');
    expect(startsLabel(m({ startAt: '2026-10-20T06:00:00.000Z' }), now, 'Asia/Muscat')).toBe('Tue 20 Oct at 10:00');
  });
});

describe('meetingCardLabel (what TalkBack reads for a card)', () => {
  it('reads the title, when and where, the project and organizer, who is coming and how far it got', () => {
    const card = m({
      id: 'c1',
      title: 'Budget review',
      startAt: '2026-10-12T06:00:00.000Z',
      endAt: '2026-10-12T07:00:00.000Z',
      location: 'Room B',
      projectId: 'p1',
      attendeeCount: 3,
      minutes: 'FINAL',
      openActionItemCount: 2,
      decisionCount: 1,
      recurrenceParentId: 'r1',
      status: 'COMPLETED',
    });
    expect(meetingCardLabel(card, ctx, 'en-US')).toBe(
      'Budget review, Mon, Oct 12, 10:00 – 11:00, Room B, Falcon CRM, organized by Aisha Khan, 3 people, Completed, Final minutes, 1 decision, 2 open action items, repeats',
    );
  });

  it('says a meeting is under way, standalone, and has nobody yet', () => {
    const live = m({ id: 'l1', title: 'Stand-up', startAt: '2026-10-10T04:30:00.000Z', endAt: '2026-10-10T05:30:00.000Z', organizerId: 'u9', attendeeCount: 0 });
    expect(meetingCardLabel(live, ctx, 'en-US')).toBe('Stand-up, Sat, Oct 10, 08:30 – 09:30, Standalone, No attendees yet, Under way');
  });
});

describe('meetingListRows (the FlatList)', () => {
  it('lays the groups out as a heading row (with its count) followed by its meetings', () => {
    const rows = meetingListRows(groupMeetings(list.slice(0, 2), ctx, 'date'));
    expect(rows.map((r) => (r.kind === 'group' ? `# ${r.label} ${r.count}` : r.meeting.id))).toEqual(['# Today 2', 'today-early', 'today-late']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('marks drafts so their cards don’t repeat the status the heading already says', () => {
    const rows = meetingListRows(groupMeetings([list[7]!, list[0]!], ctx, 'date'));
    const shown = Object.fromEntries(rows.flatMap((r) => (r.kind === 'meeting' ? [[r.meeting.id, r.statusShown]] : [])));
    expect(shown).toEqual({ 'today-late': true, draft: false });
  });
});

describe('withoutOldMeetings (the offline copy, when the whole list is too long to keep)', () => {
  it('keeps every meeting to come and the last 90 days, leaving out older ones', () => {
    const now = Date.parse('2026-10-10T05:00:00.000Z');
    const kept = withoutOldMeetings(now)([
      m({ id: 'next', startAt: '2027-01-01T00:00:00.000Z' }),
      m({ id: 'recent', startAt: '2026-08-01T00:00:00.000Z' }),
      m({ id: 'old', startAt: '2026-05-01T00:00:00.000Z' }),
      m({ id: 'bad', startAt: 'not a date' }),
    ]);
    expect(ids(kept)).toEqual(['next', 'recent', 'bad']);
  });
});

/**
 * The website's list (Web Portal/frontend/src/lib/meeting-list.ts) and this one must sort, group,
 * filter and pick "Up next" the same way. Skipped when the website's code isn't next to the app.
 */
const webList = resolve(__dirname, '../../../Web Portal/frontend/src/lib/meeting-list.ts');
describe.skipIf(!existsSync(webList))('the same as the website', () => {
  const load = async () => (await import(/* @vite-ignore */ webList)) as Record<string, (...args: unknown[]) => unknown>;
  const filters: MeetingFilters[] = [
    EMPTY_FILTERS,
    f({ q: 'falcon' }),
    f({ q: 'RETRO' }),
    f({ projectId: 'none' }),
    f({ projectId: 'p1' }),
    f({ status: 'DRAFT' }),
    f({ status: 'CANCELLED', range: 'next7' }),
    ...DATE_RANGES.map((r) => f({ range: r.value })),
  ];
  const sorts: MeetingSort[] = ['date', 'title', 'updated'];

  it('filters and groups alike', async () => {
    const web = await load();
    for (const filter of filters) {
      expect(ids(filterMeetings(list, filter, ctx)), JSON.stringify(filter)).toEqual(ids(web.filterMeetings!(list, filter, ctx) as ApiMeeting[]));
      expect(hasActiveFilters(filter)).toBe(web.hasActiveFilters!(filter));
      for (const sort of sorts) {
        const mine = groupMeetings(filterMeetings(list, filter, ctx), ctx, sort).map((g) => [g.key, g.label, ids(g.items)]);
        const theirs = (web.groupMeetings!(web.filterMeetings!(list, filter, ctx), ctx, sort) as Array<{ key: string; label: string; items: ApiMeeting[] }>).map((g) => [g.key, g.label, ids(g.items)]);
        expect(mine, `${JSON.stringify(filter)} ${sort}`).toEqual(theirs);
        expect(filterChips(filter, sort, ctx)).toEqual(web.filterChips!(filter, sort, ctx));
      }
    }
  });

  it('picks the same meeting as Up next, at any moment', async () => {
    const web = await load();
    for (const at of ['2026-10-09T20:00:00.000Z', '2026-10-10T04:45:00.000Z', '2026-10-10T05:00:00.000Z', '2026-10-10T07:00:00.000Z', '2026-10-30T00:00:00.000Z']) {
      const now = new Date(at);
      expect(nextUpMeeting(list, now)?.id ?? null, at).toBe((web.nextUpMeeting!(list, now) as ApiMeeting | null)?.id ?? null);
      for (const x of list) expect(isUnderWay(x, now)).toBe(web.isUnderWay!(x, now));
    }
  });
});
