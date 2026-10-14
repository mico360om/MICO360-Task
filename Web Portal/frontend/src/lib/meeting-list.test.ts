import { describe, it, expect } from 'vitest';
import { EMPTY_FILTERS, filterMeetings, groupMeetings, hasActiveFilters, type ListContext } from './meeting-list';
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
  it('groups into Today, Upcoming, Drafts and Past in the company’s time zone', () => {
    const groups = groupMeetings(list, ctx, 'date');
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['today', 'Today'],
      ['upcoming', 'Upcoming'],
      ['drafts', 'Drafts'],
      ['past', 'Past'],
    ]);
    const by = Object.fromEntries(groups.map((g) => [g.key, ids(g.items)]));
    // Today and Upcoming read soonest first; Past most recent first.
    expect(by.today).toEqual(['today-night', 'today-early', 'today-late']);
    expect(by.upcoming).toEqual(['cancelled', 'soon', 'later']);
    expect(by.drafts).toEqual(['draft']);
    expect(by.past).toEqual(['yesterday', 'last-month']);
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
