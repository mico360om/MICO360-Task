import { describe, it, expect } from 'vitest';
import { DEFAULT_STATUSES, filtersFromParams, milestoneText, withFilters, idleText } from './management';

describe('the Management filters in the address', () => {
  it('reads projects, owner, statuses and the period, with the defaults when left out or wrong', () => {
    expect(filtersFromParams(new URLSearchParams(''))).toEqual({ projectIds: [], ownerId: null, statuses: DEFAULT_STATUSES, weeks: 12 });
    expect(filtersFromParams(new URLSearchParams('projects=a,b&owner=u1&status=ACTIVE,ARCHIVED&weeks=26'))).toEqual({
      projectIds: ['a', 'b'],
      ownerId: 'u1',
      statuses: ['ACTIVE', 'ARCHIVED'],
      weeks: 26,
    });
    // Unknown statuses are dropped (none left: the default); an unknown period is the default.
    expect(filtersFromParams(new URLSearchParams('status=DONE&weeks=9'))).toMatchObject({ statuses: DEFAULT_STATUSES, weeks: 12 });
    expect(filtersFromParams(new URLSearchParams('status=ARCHIVED,PLANNING')).statuses).toEqual(['PLANNING', 'ARCHIVED']);
  });

  it('writes only what differs from the defaults, and keeps the address’s other parts (an open task)', () => {
    const base = new URLSearchParams('task=t1');
    const next = withFilters(base, { projectIds: ['a'], ownerId: null, statuses: DEFAULT_STATUSES, weeks: 4 });
    expect(next.toString()).toBe('task=t1&projects=a&weeks=4');
    const back = withFilters(next, { projectIds: [], ownerId: 'u9', statuses: ['COMPLETED'], weeks: 12 });
    expect(back.toString()).toBe('task=t1&owner=u9&status=COMPLETED');
    expect(filtersFromParams(back)).toEqual({ projectIds: [], ownerId: 'u9', statuses: ['COMPLETED'], weeks: 12 });
  });
});

describe('words for the table', () => {
  it('a milestone: late, today, soon, or with no date', () => {
    expect(milestoneText({ due: '2026-10-24', daysLeft: -3 })).toBe('3 days late');
    expect(milestoneText({ due: '2026-10-27', daysLeft: 0 })).toBe('Due today');
    expect(milestoneText({ due: '2026-10-28', daysLeft: 1 })).toBe('Due tomorrow');
    expect(milestoneText({ due: '2026-11-15', daysLeft: 19 })).toBe('In 19 days');
    expect(milestoneText({ due: null, daysLeft: null })).toBe('No date');
  });

  it('how long since the last activity', () => {
    expect(idleText('2026-10-27T05:00:00.000Z', '2026-10-27', 'Asia/Muscat')).toBe('Today');
    expect(idleText('2026-10-26T05:00:00.000Z', '2026-10-27', 'Asia/Muscat')).toBe('Yesterday');
    expect(idleText('2026-10-01T05:00:00.000Z', '2026-10-27', 'Asia/Muscat')).toBe('26 days ago');
  });
});
