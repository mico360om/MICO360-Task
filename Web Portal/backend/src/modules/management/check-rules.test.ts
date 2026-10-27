import { describe, it, expect } from 'vitest';
import { checkState, doneLateBetween, summarizeChecks, type CheckRow } from './check-rules';

const TZ = 'Asia/Muscat';
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
// Tuesday 27 October 2026, 10:00 in Muscat.
const NOW = new Date('2026-10-27T06:00:00.000Z');

describe('checkState: the scheduled-inspections definitions (due-date.ts isOverdue / completedOnTime)', () => {
  it('done on its day is DONE; finished after its due day (company time) is DONE_LATE', () => {
    // Due 26 October; 23:59 that day in Muscat is 19:59 UTC — on time. 00:01 the next day — late.
    expect(checkState({ dueDate: day('2026-10-26'), completedAt: new Date('2026-10-26T19:59:00.000Z'), columnCategory: 'DONE' }, TZ, NOW)).toBe('DONE');
    expect(checkState({ dueDate: day('2026-10-26'), completedAt: new Date('2026-10-26T20:01:00.000Z'), columnCategory: 'DONE' }, TZ, NOW)).toBe('DONE_LATE');
  });

  it('open and past its due day is LATE (missing); open and due today or later is DUE', () => {
    expect(checkState({ dueDate: day('2026-10-26'), completedAt: null, columnCategory: 'TODO' }, TZ, NOW)).toBe('LATE');
    expect(checkState({ dueDate: day('2026-10-27'), completedAt: null, columnCategory: 'IN_PROGRESS' }, TZ, NOW)).toBe('DUE');
    expect(checkState({ dueDate: null, completedAt: null, columnCategory: 'TODO' }, TZ, NOW)).toBe('DUE');
  });

  it('a Done column without a completion time is done (never late: there is no time to judge)', () => {
    expect(checkState({ dueDate: day('2026-10-01'), completedAt: null, columnCategory: 'DONE' }, TZ, NOW)).toBe('DONE');
  });
});

describe('summarizeChecks: the period’s checks (due from its first day to today) and the missing ones now', () => {
  const row = (id: string, projectId: string, due: string | null, completedAt: string | null, hasReport = true, columnCategory = completedAt ? 'DONE' : 'TODO'): CheckRow => ({
    id,
    projectId,
    dueDate: due ? day(due) : null,
    completedAt: completedAt ? new Date(completedAt) : null,
    columnCategory,
    hasReport,
  });
  const rows: CheckRow[] = [
    row('a', 'p1', '2026-10-20', '2026-10-20T08:00:00.000Z'), // done on time
    row('b', 'p1', '2026-10-21', '2026-10-23T08:00:00.000Z'), // done late
    row('c', 'p1', '2026-10-22', null), // missing
    row('d', 'p1', '2026-10-27', null), // due today: not missing yet
    row('e', 'p2', '2026-10-25', '2026-10-25T08:00:00.000Z', false), // done, closed without a report
    row('f', 'p2', '2026-09-01', null), // missing, before the period: still missing now
    row('g', 'p2', '2026-09-02', '2026-09-02T08:00:00.000Z'), // before the period
    row('h', 'p2', '2026-10-30', null), // later than today: not due yet
  ];

  it('counts due, done, done late, closed without a report (in the period) and missing (now), per project and in all', () => {
    const s = summarizeChecks(rows, { from: '2026-10-04', today: '2026-10-27', timeZone: TZ, now: NOW });
    expect(s.total).toEqual({ due: 5, done: 3, doneLate: 1, noReport: 1, missing: 2 });
    expect(s.byProject.get('p1')).toEqual({ due: 4, done: 2, doneLate: 1, noReport: 0, missing: 1 });
    expect(s.byProject.get('p2')).toEqual({ due: 1, done: 1, doneLate: 0, noReport: 1, missing: 1 });
  });

  it('done late between two moments: by when the check was finished', () => {
    const lastWeek = doneLateBetween(rows, new Date('2026-10-17T20:00:00.000Z'), new Date('2026-10-24T20:00:00.000Z'), TZ);
    expect(lastWeek.map((r) => r.id)).toEqual(['b']);
  });
});
