import { describe, it, expect } from 'vitest';
import { EMPTY_FILTERS, filterChips, filterMeetings, groupMeetings, hasActiveFilters, hasEnded, lastMeeting, meetingSummary, nextUpMeeting, startsLabel, whenItWas, type ListContext } from './meeting-list';
import { formatClockTime } from './meetingFormat';
import type { Meeting } from '../api/meetings';

const m = (over: Partial<Meeting>): Meeting => ({
  id: 'x', title: 'Meeting', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: '2026-10-10T06:00:00.000Z', endAt: null, timeZone: null, recurrenceRule: null,
  recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
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
  m({ id: 'today-early', title: 'Stand-up', startAt: '2026-10-10T04:30:00.000Z' }),
  // 22:30 UTC on the 9th is 02:30 on the 10th in Muscat: still today there.
  m({ id: 'today-night', title: 'Night shift handover', startAt: '2026-10-09T22:30:00.000Z' }),
  m({ id: 'soon', title: 'اجتماع الميزانية', startAt: '2026-10-12T06:00:00.000Z', organizerId: 'u2', location: 'Room B' }),
  m({ id: 'later', title: 'Quarterly planning', startAt: '2026-11-02T06:00:00.000Z' }),
  m({ id: 'yesterday', title: 'Retro', startAt: '2026-10-09T10:00:00.000Z', status: 'COMPLETED' }),
  m({ id: 'last-month', title: 'Kick-off', startAt: '2026-09-01T06:00:00.000Z', status: 'COMPLETED', updatedAt: '2026-10-09T00:00:00.000Z' }),
  m({ id: 'draft', title: 'Draft: hiring plan', startAt: '2026-10-20T06:00:00.000Z', status: 'DRAFT' }),
  m({ id: 'cancelled', title: 'Vendor call', startAt: '2026-10-11T06:00:00.000Z', status: 'CANCELLED' }),
];
const ids = (ms: Meeting[]) => ms.map((x) => x.id);

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
    expect(groups.map((g) => [g.key, ids(g.items)])).toEqual([['next7', ['d7']], ['later', ['d8']]]);
  });

  it('leaves out empty groups', () => {
    expect(groupMeetings([list[5]!], ctx, 'date').map((g) => g.key)).toEqual(['past']);
    expect(groupMeetings([], ctx, 'date')).toEqual([]);
  });

  it('sorts within each group by title or by last change when asked', () => {
    const today = (sort: 'title' | 'updated') => ids(groupMeetings(list, ctx, sort).find((g) => g.key === 'today')!.items);
    expect(today('title')).toEqual(['today-late', 'today-night', 'today-early']);
    const past = ids(groupMeetings(list, ctx, 'updated').find((g) => g.key === 'past')!.items);
    expect(past).toEqual(['last-month', 'yesterday']);
  });
});

describe('nextUpMeeting', () => {
  it('features the meeting under way', () => {
    const live = m({ id: 'live', status: 'IN_PROGRESS', startAt: '2026-10-10T02:00:00.000Z', endAt: '2026-10-10T03:00:00.000Z' });
    expect(nextUpMeeting([...list, live], ctx.now)?.id).toBe('live');
  });

  it('counts a scheduled meeting as under way from its start to its end (an hour when it has none)', () => {
    // 05:00 UTC: the stand-up began at 04:30 with no end, so it runs until 05:30.
    expect(nextUpMeeting(list, ctx.now)?.id).toBe('today-early');
  });

  it('otherwise the soonest scheduled meeting to come, never a draft or a cancelled one', () => {
    expect(nextUpMeeting(list, new Date('2026-10-10T06:00:00.000Z'))?.id).toBe('today-late');
    // After the budget review: the cancelled vendor call (11 Oct) is passed over.
    expect(nextUpMeeting(list, new Date('2026-10-10T13:30:00.000Z'))?.id).toBe('soon');
  });

  it('has none when nothing is coming', () => {
    expect(nextUpMeeting([list[5]!, list[7]!], ctx.now)).toBeNull();
  });
});

describe('startsLabel', () => {
  const TZ = 'Asia/Muscat';
  const now = new Date('2026-10-10T05:00:00.000Z'); // Sat 10 Oct, 09:00 in Muscat
  const at = (startAt: string, endAt: string | null = null) => m({ startAt, endAt });
  const clock = (iso: string) => formatClockTime(iso, TZ);

  it('says when a meeting is under way', () => {
    expect(startsLabel(at('2026-10-10T04:30:00.000Z'), now, TZ)).toBe('Happening now');
    expect(startsLabel(m({ status: 'IN_PROGRESS', startAt: '2026-10-10T05:30:00.000Z' }), now, TZ)).toBe('Happening now');
  });

  it('counts the last hour down in minutes', () => {
    expect(startsLabel(at('2026-10-10T05:25:00.000Z'), now, TZ)).toBe('in 25 min');
    expect(startsLabel(at('2026-10-10T05:59:00.000Z'), now, TZ)).toBe('in 59 min');
    expect(startsLabel(at('2026-10-10T05:00:20.000Z'), now, TZ)).toBe('Starting now');
  });

  it('names the day and the time further ahead', () => {
    expect(startsLabel(at('2026-10-10T10:00:00.000Z'), now, TZ)).toBe(`Today at ${clock('2026-10-10T10:00:00.000Z')}`);
    expect(startsLabel(at('2026-10-11T06:00:00.000Z'), now, TZ)).toBe(`Tomorrow at ${clock('2026-10-11T06:00:00.000Z')}`);
    expect(startsLabel(at('2026-10-14T06:00:00.000Z'), now, TZ)).toBe(`Wednesday at ${clock('2026-10-14T06:00:00.000Z')}`);
    expect(startsLabel(at('2026-10-20T06:00:00.000Z'), now, TZ)).toBe(`Tue 20 Oct at ${clock('2026-10-20T06:00:00.000Z')}`);
  });
});

describe('filterChips', () => {
  it('names each filter in use, and a sort other than by date', () => {
    expect(filterChips({ ...EMPTY_FILTERS, q: 'budget', projectId: 'p1', range: 'next7', status: 'COMPLETED' }, 'title', ctx)).toEqual([
      { key: 'project', label: 'Project: Falcon CRM' },
      { key: 'date', label: 'Date: Next 7 days' },
      { key: 'status', label: 'Status: Completed' },
      { key: 'sort', label: 'Sorted by title' },
    ]);
  });

  it('words standalone meetings and custom dates plainly', () => {
    expect(filterChips({ ...EMPTY_FILTERS, projectId: 'none', range: 'custom', from: '2026-10-01', to: '2026-10-31' }, 'date', ctx)).toEqual([
      { key: 'project', label: 'Standalone meetings only' },
      { key: 'date', label: 'Date: 1 Oct 2026 – 31 Oct 2026' },
    ]);
    expect(filterChips({ ...EMPTY_FILTERS, range: 'custom', from: '2026-10-01' }, 'updated', ctx)).toEqual([
      { key: 'date', label: 'Date: from 1 Oct 2026' },
      { key: 'sort', label: 'Recently updated first' },
    ]);
  });

  it('has none when nothing is filtered (the search shows in its own box)', () => {
    expect(filterChips({ ...EMPTY_FILTERS, q: 'budget' }, 'date', ctx)).toEqual([]);
  });
});

describe('filterMeetings', () => {
  it('searches titles (Arabic too), places, projects and organizers', () => {
    expect(ids(filterMeetings(list, { ...EMPTY_FILTERS, q: 'budget' }, ctx))).toEqual(['today-late']);
    expect(ids(filterMeetings(list, { ...EMPTY_FILTERS, q: 'الميزانية' }, ctx))).toEqual(['soon']);
    expect(ids(filterMeetings(list, { ...EMPTY_FILTERS, q: 'room b' }, ctx))).toEqual(['soon']);
    expect(ids(filterMeetings(list, { ...EMPTY_FILTERS, q: 'falcon' }, ctx))).toEqual(['today-late']);
    expect(ids(filterMeetings(list, { ...EMPTY_FILTERS, q: '  omar ' }, ctx))).toEqual(['soon']);
  });

  it('filters by project, standalone and status', () => {
    expect(ids(filterMeetings(list, { ...EMPTY_FILTERS, projectId: 'p1' }, ctx))).toEqual(['today-late']);
    expect(filterMeetings(list, { ...EMPTY_FILTERS, projectId: 'none' }, ctx)).toHaveLength(list.length - 1);
    expect(ids(filterMeetings(list, { ...EMPTY_FILTERS, status: 'DRAFT' }, ctx))).toEqual(['draft']);
  });

  it('filters by date range in the company’s time zone', () => {
    const range = (r: typeof EMPTY_FILTERS.range, extra = {}) => ids(filterMeetings(list, { ...EMPTY_FILTERS, range: r, ...extra }, ctx)).sort();
    expect(range('today')).toEqual(['today-early', 'today-late', 'today-night']);
    expect(range('next7')).toEqual(['cancelled', 'soon', 'today-early', 'today-late', 'today-night']);
    expect(range('last7')).toEqual(['today-early', 'today-late', 'today-night', 'yesterday']);
    expect(range('month')).toEqual(['cancelled', 'draft', 'soon', 'today-early', 'today-late', 'today-night', 'yesterday']);
    expect(range('custom', { from: '2026-10-11', to: '2026-10-12' })).toEqual(['cancelled', 'soon']);
    expect(range('custom', { from: '2026-11-01' })).toEqual(['later']);
  });

  it('knows when any filter is on', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: ' ' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, status: 'COMPLETED' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, range: 'today' })).toBe(true);
  });
});

describe('meetingSummary — the numbers above the list', () => {
  // The same meetings, with how far each one got.
  const withProgress = list.map((x) =>
    x.id === 'yesterday' ? { ...x, minutes: 'DRAFT' as const, openActionItemCount: 2 }
      : x.id === 'last-month' ? { ...x, minutes: 'FINAL' as const, openActionItemCount: 1 }
        : x.id === 'today-night' ? { ...x, minutes: 'NONE' as const }
          : x,
  );

  it('counts what is still to come in the next 7 days (today and the six days after), never a draft, cancelled or finished one', () => {
    // The stand-up is under way, the budget review is later today, the Arabic meeting is on the 12th.
    // The night handover (02:30) is over; the vendor call is cancelled; the draft and 2 Nov are out.
    expect(meetingSummary(withProgress, ctx).week).toBe(3);
    expect(ids(filterMeetings(withProgress, { ...EMPTY_FILTERS, focus: 'week' }, ctx))).toEqual(['today-late', 'today-early', 'soon']);
    // The sixth day ahead is in, the seventh is not.
    const edge = [m({ id: 'd6', startAt: '2026-10-16T06:00:00.000Z' }), m({ id: 'd7', startAt: '2026-10-17T06:00:00.000Z' })];
    expect(meetingSummary(edge, ctx).week).toBe(1);
  });

  it('adds up the open action items, and shows the meetings that have them', () => {
    const s = meetingSummary(withProgress, ctx);
    expect(s.actions).toBe(3);
    expect(s.actionMeetings).toBe(2);
    expect(ids(filterMeetings(withProgress, { ...EMPTY_FILTERS, focus: 'actions' }, ctx))).toEqual(['yesterday', 'last-month']);
  });

  it('counts the meetings that are over without final minutes (a finished one with final minutes is done)', () => {
    expect(meetingSummary(withProgress, ctx).minutes).toBe(2);
    expect(ids(filterMeetings(withProgress, { ...EMPTY_FILTERS, focus: 'minutes' }, ctx))).toEqual(['today-night', 'yesterday']);
  });

  it('counts the meetings held this month in the company’s time zone (over, not cancelled)', () => {
    expect(meetingSummary(withProgress, ctx).held).toBe(2);
    expect(ids(filterMeetings(withProgress, { ...EMPTY_FILTERS, focus: 'held' }, ctx))).toEqual(['today-night', 'yesterday']);
    // 1 Oct 01:00 in Muscat is still 30 Sep in UTC: it belongs to October.
    const early = m({ id: 'oct1', status: 'COMPLETED', startAt: '2026-09-30T21:00:00.000Z' });
    expect(meetingSummary([early], ctx).held).toBe(1);
  });

  it('reads 0 for everything when there are no meetings', () => {
    expect(meetingSummary([], ctx)).toEqual({ week: 0, actions: 0, actionMeetings: 0, minutes: 0, held: 0 });
  });

  it('the owner’s case: two finished meetings with drafted minutes, nothing coming up', () => {
    const now = new Date('2026-10-29T20:46:00.000Z'); // 30 Oct, 00:46 in Muscat
    const owner = [
      m({ id: 'iso', status: 'COMPLETED', startAt: '2026-10-29T05:00:00.000Z', endAt: '2026-10-29T13:00:00.000Z', minutes: 'DRAFT', openActionItemCount: 0 }),
      m({ id: 'oct', status: 'COMPLETED', startAt: '2026-10-06T09:00:00.000Z', endAt: null, minutes: 'DRAFT', openActionItemCount: 2 }),
    ];
    expect(meetingSummary(owner, { ...ctx, now })).toEqual({ week: 0, actions: 2, actionMeetings: 1, minutes: 2, held: 2 });
    expect(nextUpMeeting(owner, now)).toBeNull();
    expect(lastMeeting(owner, now)?.id).toBe('iso');
    expect(whenItWas(owner[0]!.startAt, now, 'Asia/Muscat')).toBe('yesterday');
  });
});

describe('the focus filters', () => {
  it('are filters like the others: on, named as a chip, and kept apart from the Filters panel', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, focus: 'minutes' })).toBe(true);
    expect(filterChips({ ...EMPTY_FILTERS, focus: 'minutes', status: 'COMPLETED' }, 'date', ctx)).toEqual([
      { key: 'status', label: 'Status: Completed' },
      { key: 'focus', label: 'Minutes to finish' },
    ]);
    expect(filterChips({ ...EMPTY_FILTERS, focus: 'week' }, 'date', ctx)).toEqual([{ key: 'focus', label: 'Next 7 days' }]);
    expect(filterChips({ ...EMPTY_FILTERS, focus: 'actions' }, 'date', ctx)).toEqual([{ key: 'focus', label: 'With open action items' }]);
    expect(filterChips({ ...EMPTY_FILTERS, focus: 'held' }, 'date', ctx)).toEqual([{ key: 'focus', label: 'Held this month' }]);
  });
});

describe('hasEnded', () => {
  it('a finished meeting, or a scheduled one past its end (an hour when it has none); never one under way, a draft or a cancelled one', () => {
    expect(hasEnded(m({ status: 'COMPLETED', startAt: '2026-10-11T06:00:00.000Z' }), ctx.now)).toBe(true);
    expect(hasEnded(m({ startAt: '2026-10-09T22:30:00.000Z' }), ctx.now)).toBe(true);
    expect(hasEnded(m({ startAt: '2026-10-10T04:30:00.000Z' }), ctx.now)).toBe(false);
    expect(hasEnded(m({ startAt: '2026-10-10T02:00:00.000Z', endAt: '2026-10-10T06:00:00.000Z' }), ctx.now)).toBe(false);
    expect(hasEnded(m({ status: 'IN_PROGRESS', startAt: '2026-10-01T06:00:00.000Z' }), ctx.now)).toBe(false);
    expect(hasEnded(m({ status: 'DRAFT', startAt: '2026-10-01T06:00:00.000Z' }), ctx.now)).toBe(false);
    expect(hasEnded(m({ status: 'CANCELLED', startAt: '2026-10-01T06:00:00.000Z' }), ctx.now)).toBe(false);
  });
});

describe('lastMeeting and whenItWas — the "Nothing coming up" line', () => {
  it('is the most recent meeting that is over, never a draft or a cancelled one', () => {
    expect(lastMeeting(list, ctx.now)?.id).toBe('today-night');
    expect(lastMeeting([list[5]!, list[6]!], ctx.now)?.id).toBe('yesterday');
    expect(lastMeeting([list[7]!, list[8]!], ctx.now)).toBeNull();
    expect(lastMeeting([], ctx.now)).toBeNull();
  });

  it('says when, from today, in the company’s time zone', () => {
    const TZ = 'Asia/Muscat';
    expect(whenItWas('2026-10-09T22:30:00.000Z', ctx.now, TZ)).toBe('earlier today');
    expect(whenItWas('2026-10-09T10:00:00.000Z', ctx.now, TZ)).toBe('yesterday');
    expect(whenItWas('2026-10-05T06:00:00.000Z', ctx.now, TZ)).toBe('on Monday');
    expect(whenItWas('2026-10-03T06:00:00.000Z', ctx.now, TZ)).toBe('on Sat 3 Oct');
    expect(whenItWas('2025-12-01T06:00:00.000Z', ctx.now, TZ)).toBe('on 1 Dec 2025');
  });
});
