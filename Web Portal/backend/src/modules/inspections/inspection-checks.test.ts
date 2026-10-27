import { describe, it, expect } from 'vitest';
import { checkState, closedWithoutReport, compareOpenChecks, daysLate, isCheck, isCheckDone, isSchedule, type CheckTask } from './inspection-checks';

const TZ = 'Asia/Muscat'; // UTC+4, no daylight saving
const day = (key: string) => new Date(`${key}T00:00:00.000Z`); // a due date as stored (UTC midnight of its day)
const check = (over: Partial<CheckTask> = {}): CheckTask => ({ dueDate: day('2026-10-27'), completedAt: null, columnCategory: 'TODO', inspectionFormId: 'f1', recurrenceRule: null, deletedAt: null, ...over });

describe('what counts as a check and a schedule', () => {
  it('a check is a live task that carries a form; a schedule is a check that carries the repeat', () => {
    expect(isCheck(check())).toBe(true);
    expect(isCheck(check({ inspectionFormId: null }))).toBe(false);
    expect(isCheck(check({ deletedAt: new Date() }))).toBe(false);
    expect(isSchedule(check())).toBe(false);
    expect(isSchedule(check({ recurrenceRule: { freq: 'DAILY', interval: 1 } }))).toBe(true);
    expect(isSchedule(check({ recurrenceRule: { freq: 'DAILY', interval: 1 }, inspectionFormId: null }))).toBe(false);
  });

  it('done is a Done column or a completion time', () => {
    expect(isCheckDone(check())).toBe(false);
    expect(isCheckDone(check({ columnCategory: 'DONE' }))).toBe(true);
    expect(isCheckDone(check({ completedAt: new Date() }))).toBe(true);
  });
});

describe('a check’s state, in the company time zone', () => {
  it('open: due until the end of its day, late from the next day', () => {
    // 23:59 on the 27th in Muscat is 19:59 UTC.
    expect(checkState(check(), TZ, new Date('2026-10-27T19:59:00Z'))).toBe('DUE');
    // 00:01 on the 28th in Muscat is 20:01 UTC on the 27th.
    expect(checkState(check(), TZ, new Date('2026-10-27T20:01:00Z'))).toBe('LATE');
    expect(checkState(check({ dueDate: null }), TZ, new Date('2030-01-01T00:00:00Z'))).toBe('DUE');
  });

  it('done on its day is DONE; finished after the end of its day is DONE_LATE (at the day boundary)', () => {
    const at = (iso: string) => checkState(check({ completedAt: new Date(iso), columnCategory: 'DONE' }), TZ, new Date('2026-11-05T08:00:00Z'));
    expect(at('2026-10-27T19:59:00Z')).toBe('DONE'); // 23:59 on the 27th
    expect(at('2026-10-27T20:01:00Z')).toBe('DONE_LATE'); // 00:01 on the 28th
    expect(at('2026-10-26T10:00:00Z')).toBe('DONE'); // early
  });

  it('a check in a Done column without a completion time (older rows) is DONE', () => {
    expect(checkState(check({ columnCategory: 'DONE' }), TZ, new Date('2026-11-05T08:00:00Z'))).toBe('DONE');
  });
});

describe('how late', () => {
  const now = new Date('2026-10-29T08:00:00Z'); // the 29th in Muscat
  it('an open check counts the days since its due day', () => {
    expect(daysLate(check(), TZ, now)).toBe(2);
    expect(daysLate(check({ dueDate: day('2026-10-29') }), TZ, now)).toBe(0);
    expect(daysLate(check({ dueDate: day('2026-11-02') }), TZ, now)).toBe(0);
    expect(daysLate(check({ dueDate: null }), TZ, now)).toBe(0);
  });
  it('a finished check counts the days from its due day to the day it was finished', () => {
    expect(daysLate(check({ completedAt: new Date('2026-10-30T05:00:00Z') }), TZ, now)).toBe(3);
    expect(daysLate(check({ completedAt: new Date('2026-10-27T20:01:00Z') }), TZ, now)).toBe(1);
    expect(daysLate(check({ completedAt: new Date('2026-10-27T19:59:00Z') }), TZ, now)).toBe(0);
  });
});

describe('closed without a report', () => {
  it('is a done check with no finished inspection linked to it', () => {
    const done = check({ completedAt: new Date('2026-10-27T10:00:00Z') });
    expect(closedWithoutReport(done, false)).toBe(true);
    expect(closedWithoutReport(done, true)).toBe(false);
    expect(closedWithoutReport(check(), false)).toBe(false);
    expect(closedWithoutReport({ ...done, inspectionFormId: null }, false)).toBe(false);
  });
});

describe('the order of open checks', () => {
  it('late first (the latest-overdue first), then due today, then upcoming, then undated', () => {
    const rows = [
      { id: 'up', ...check({ dueDate: day('2026-11-01') }) },
      { id: 'none', ...check({ dueDate: null }) },
      { id: 'late1', ...check({ dueDate: day('2026-10-28') }) },
      { id: 'today', ...check({ dueDate: day('2026-10-29') }) },
      { id: 'late3', ...check({ dueDate: day('2026-10-26') }) },
    ];
    expect([...rows].sort(compareOpenChecks(TZ)).map((r) => r.id)).toEqual(['late3', 'late1', 'today', 'up', 'none']);
  });
});
