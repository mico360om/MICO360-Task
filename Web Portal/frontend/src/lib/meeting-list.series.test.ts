import { describe, it, expect } from 'vitest';
import { EMPTY_FILTERS, filterChips, filterMeetings, hasActiveFilters, seriesOptions, type ListContext } from './meeting-list';
import type { Meeting } from '../api/meetings';

// 1.23 Meeting series on the Meetings page: a Series filter (from the meetings listed) and its chip.
const m = (over: Partial<Meeting>): Meeting => ({
  id: 'x', title: 'Meeting', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: '2026-10-10T06:00:00.000Z', endAt: null, timeZone: null, recurrenceRule: null,
  recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', seriesId: null, seriesName: null, ...over,
});
const ctx: ListContext = {
  timeZone: 'Asia/Muscat',
  now: new Date('2026-10-10T05:00:00.000Z'),
  projectName: () => null,
  organizerName: () => null,
  seriesName: (id) => ({ s1: 'Monthly site review' } as Record<string, string>)[id] ?? null,
};
const list = [
  m({ id: 'a', seriesId: 's1', seriesName: 'Monthly site review' }),
  m({ id: 'b', seriesId: 's2', seriesName: 'Board' }),
  m({ id: 'c' }),
  m({ id: 'd', seriesId: 's1', seriesName: 'Monthly site review' }),
];

describe('the Series filter', () => {
  it('keeps only the meetings of the chosen series', () => {
    expect(filterMeetings(list, { ...EMPTY_FILTERS, seriesId: 's1' }, ctx).map((x) => x.id)).toEqual(['a', 'd']);
    expect(filterMeetings(list, EMPTY_FILTERS, ctx)).toHaveLength(4);
  });

  it('counts as a filter in use, with a chip named after the series', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, seriesId: 's1' })).toBe(true);
    expect(filterChips({ ...EMPTY_FILTERS, seriesId: 's1' }, 'date', ctx)).toEqual([{ key: 'series', label: 'Series: Monthly site review' }]);
  });

  it('offers each series of the meetings listed once, by name', () => {
    expect(seriesOptions(list)).toEqual([{ id: 's2', name: 'Board' }, { id: 's1', name: 'Monthly site review' }]);
  });
});
