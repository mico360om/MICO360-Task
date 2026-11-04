import { describe, it, expect } from 'vitest';
import { ACTIVITY_KINDS, actionsOfKind, countPerDay, dayBounds, daysQuery, dayQuery, MAX_CALENDAR_DAYS } from './activity-days';

describe('countPerDay — changes per calendar day, in the site’s time zone', () => {
  it('puts each change on its day in the zone, oldest day first, leaving out quiet days', () => {
    const at = (iso: string) => new Date(iso);
    // 21:30 UTC on 31 Oct is 01:30 on 1 Nov in Muscat (UTC+4).
    const times = [at('2026-10-31T19:00:00Z'), at('2026-10-31T21:30:00Z'), at('2026-11-01T08:00:00Z'), at('2026-11-03T10:00:00Z')];
    expect(countPerDay(times, 'Asia/Muscat')).toEqual([
      { day: '2026-10-31', count: 1 },
      { day: '2026-11-01', count: 2 },
      { day: '2026-11-03', count: 1 },
    ]);
  });

  it('follows a zone with summer time (London, the clocks went back on 25 Oct)', () => {
    const times = [new Date('2026-10-24T23:30:00Z'), new Date('2026-10-25T23:30:00Z')];
    // 24 Oct 23:30 UTC is 00:30 BST on the 25th; 25 Oct 23:30 UTC is 23:30 GMT on the 25th.
    expect(countPerDay(times, 'Europe/London')).toEqual([{ day: '2026-10-25', count: 2 }]);
  });

  it('is empty with no changes', () => {
    expect(countPerDay([], 'Asia/Muscat')).toEqual([]);
  });
});

describe('dayBounds — the instants a run of days covers in a zone', () => {
  it('from the start of the first day to the start of the day after the last', () => {
    const { from, to } = dayBounds('2026-11-01', '2026-11-30', 'Asia/Muscat');
    expect(from.toISOString()).toBe('2026-10-31T20:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-30T20:00:00.000Z');
  });
});

describe('the kinds of change the Activity filters offer', () => {
  it('Completed takes in reopenings and approvals, as the list does; the others are one action each', () => {
    expect(actionsOfKind('COMPLETED')).toEqual(['COMPLETED', 'REOPENED', 'APPROVED']);
    expect(actionsOfKind('CREATED')).toEqual(['CREATED']);
    expect(actionsOfKind('MOVED')).toEqual(['MOVED']);
    expect(actionsOfKind('ASSIGNED')).toEqual(['ASSIGNED']);
    expect(actionsOfKind(undefined)).toBeNull();
    expect(Object.keys(ACTIVITY_KINDS)).toEqual(['CREATED', 'MOVED', 'COMPLETED', 'ASSIGNED']);
  });
});

describe('the calendar’s questions', () => {
  it('asks for a run of real days, the first on or before the last, at most a quarter long', () => {
    expect(daysQuery.parse({ from: '2026-10-25', to: '2026-12-05' })).toEqual({ from: '2026-10-25', to: '2026-12-05' });
    expect(daysQuery.parse({ from: '2026-11-01', to: '2026-11-01', kind: 'COMPLETED' }).kind).toBe('COMPLETED');
    expect(() => daysQuery.parse({ from: '2026-11-05', to: '2026-11-01' })).toThrow();
    expect(() => daysQuery.parse({ from: '2026-02-30', to: '2026-03-01' })).toThrow();
    expect(() => daysQuery.parse({ from: '2026-11-01' })).toThrow();
    expect(() => daysQuery.parse({ from: '2026-01-01', to: '2026-12-31' })).toThrow();
    expect(() => daysQuery.parse({ from: '2026-11-01', to: '2026-11-02', kind: 'SOMETHING' })).toThrow();
    expect(MAX_CALENDAR_DAYS).toBe(92);
  });

  it('asks for one real day, with an optional place to carry on from', () => {
    expect(dayQuery.parse({ day: '2026-11-03' })).toEqual({ day: '2026-11-03' });
    expect(dayQuery.parse({ day: '2026-11-03', before: 'clx123', kind: 'MOVED' })).toEqual({ day: '2026-11-03', before: 'clx123', kind: 'MOVED' });
    expect(() => dayQuery.parse({ day: '3 Nov' })).toThrow();
    expect(() => dayQuery.parse({ day: '2026-11-03', before: '' })).toThrow();
  });
});
