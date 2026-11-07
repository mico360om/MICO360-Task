import { describe, expect, it } from 'vitest';
import { holdUpOf, isLongHoldUp, milestoneRisk, timeUsedPct, workloadOf } from './health-facts';

const TZ = 'Asia/Muscat';
const ctx = { today: '2026-11-20', timeZone: TZ };
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
/** A moment in company time (Muscat is UTC+4). */
const at = (key: string, hh = 10) => new Date(`${key}T${String(hh - 4).padStart(2, '0')}:00:00.000Z`);
const base = { columnCategory: 'IN_PROGRESS', movedAt: null, updatedAt: at('2026-11-01'), startDate: null, dueDate: null, openBlockerDues: [] as (Date | null)[] };

describe('blocked — only a real hold-up counts (design call 2)', () => {
  it('a task in a Blocked column: its clock starts when it moved into that column', () => {
    expect(holdUpOf({ ...base, columnCategory: 'BLOCKED', movedAt: at('2026-11-10'), updatedAt: at('2026-11-19') }, ctx)).toEqual({ kind: 'status', since: '2026-11-10', days: 10 });
  });

  it('…and a task with no such history uses its last update', () => {
    expect(holdUpOf({ ...base, columnCategory: 'BLOCKED', movedAt: null, updatedAt: at('2026-11-15') }, ctx)).toEqual({ kind: 'status', since: '2026-11-15', days: 5 });
  });

  it('a planned sequence — waiting on a blocker that is not late, its own dates not passed — is no hold-up', () => {
    expect(holdUpOf({ ...base, openBlockerDues: [day('2026-11-25')], startDate: day('2026-11-26'), dueDate: day('2026-11-30') }, ctx)).toBeNull();
    expect(holdUpOf({ ...base, openBlockerDues: [null] }, ctx)).toBeNull();
  });

  it('waiting on a blocker that is overdue: held up from the day after the blocker’s due day', () => {
    expect(holdUpOf({ ...base, openBlockerDues: [day('2026-11-10'), day('2026-11-25')] }, ctx)).toEqual({ kind: 'dependency', since: '2026-11-11', days: 9 });
  });

  it('waiting while its own start or due date has passed: held up from the day after that date', () => {
    expect(holdUpOf({ ...base, openBlockerDues: [day('2026-11-25')], startDate: day('2026-11-12') }, ctx)).toEqual({ kind: 'dependency', since: '2026-11-13', days: 7 });
    expect(holdUpOf({ ...base, openBlockerDues: [null], dueDate: day('2026-11-05') }, ctx)).toEqual({ kind: 'dependency', since: '2026-11-06', days: 14 });
  });

  it('the earliest of its clocks wins; a date passed only today is not yet a hold-up', () => {
    expect(holdUpOf({ ...base, openBlockerDues: [day('2026-11-08')], startDate: day('2026-11-01'), dueDate: day('2026-11-15') }, ctx)).toMatchObject({ since: '2026-11-02', days: 18 });
    expect(holdUpOf({ ...base, openBlockerDues: [day('2026-11-20')] }, ctx)).toBeNull();
    expect(holdUpOf({ ...base, openBlockerDues: [day('2026-11-19')] }, ctx)).toEqual({ kind: 'dependency', since: '2026-11-20', days: 0 });
  });

  it('a Blocked-column task that also waits on a late blocker keeps the earlier clock', () => {
    expect(holdUpOf({ ...base, columnCategory: 'BLOCKED', movedAt: at('2026-11-15'), openBlockerDues: [day('2026-11-02')] }, ctx)).toEqual({ kind: 'dependency', since: '2026-11-03', days: 17 });
  });

  it('“over 7 days” is 8 days or more', () => {
    expect(isLongHoldUp({ kind: 'status', since: '2026-11-13', days: 7 })).toBe(false);
    expect(isLongHoldUp({ kind: 'status', since: '2026-11-12', days: 8 })).toBe(true);
  });
});

describe('milestones at risk (design call 1)', () => {
  const m = { dueDate: day('2026-11-24'), waiting: false, linked: { total: 6, open: 3 } };

  it('due within 7 days with half or more of its linked work open', () => {
    expect(milestoneRisk(m, ctx)).toEqual({ daysLeft: 4, open: 3, total: 6 });
    expect(milestoneRisk({ ...m, dueDate: day('2026-11-20') }, ctx)).toMatchObject({ daysLeft: 0 });
    expect(milestoneRisk({ ...m, dueDate: day('2026-11-27') }, ctx)).toMatchObject({ daysLeft: 7 });
  });

  it('not at risk: under half open, nothing linked, more than 7 days away, already late, undated or waiting for approval', () => {
    expect(milestoneRisk({ ...m, linked: { total: 6, open: 2 } }, ctx)).toBeNull();
    expect(milestoneRisk({ ...m, linked: { total: 0, open: 0 } }, ctx)).toBeNull();
    expect(milestoneRisk({ ...m, dueDate: day('2026-11-28') }, ctx)).toBeNull();
    expect(milestoneRisk({ ...m, dueDate: day('2026-11-19') }, ctx)).toBeNull();
    expect(milestoneRisk({ ...m, dueDate: null }, ctx)).toBeNull();
    expect(milestoneRisk({ ...m, waiting: true }, ctx)).toBeNull();
  });
});

describe('workload (design call 3)', () => {
  it('one person with 8+ open tasks and 40%+ of the project’s open tasks', () => {
    expect(workloadOf(20, [{ userId: 'a', count: 8 }, { userId: 'b', count: 3 }, { userId: 'c', count: 2 }])).toEqual({ userId: 'a', count: 8, openTotal: 20, pct: 40 });
  });

  it('not with 7 tasks, nor under 40%', () => {
    expect(workloadOf(10, [{ userId: 'a', count: 7 }, { userId: 'b', count: 1 }, { userId: 'c', count: 1 }])).toBeNull();
    expect(workloadOf(21, [{ userId: 'a', count: 8 }, { userId: 'b', count: 3 }, { userId: 'c', count: 2 }])).toBeNull();
  });

  it('projects whose open work is spread over 2 or fewer people are exempt', () => {
    expect(workloadOf(12, [{ userId: 'a', count: 10 }, { userId: 'b', count: 2 }])).toBeNull();
    expect(workloadOf(12, [{ userId: 'a', count: 12 }])).toBeNull();
  });

  it('the busiest person is named (ties: the first by id)', () => {
    expect(workloadOf(18, [{ userId: 'b', count: 9 }, { userId: 'a', count: 9 }, { userId: 'c', count: 1 }])).toMatchObject({ userId: 'a', count: 9, pct: 50 });
  });
});

describe('time used', () => {
  it('days gone ÷ days planned, 0–100', () => {
    expect(timeUsedPct(day('2026-11-10'), day('2026-11-30'), '2026-11-20', TZ)).toBe(50);
    expect(timeUsedPct(day('2026-11-25'), day('2026-11-30'), '2026-11-20', TZ)).toBe(0);
    expect(timeUsedPct(day('2026-10-01'), day('2026-11-01'), '2026-11-20', TZ)).toBe(100);
  });

  it('none without both dates, or with a target not after the start', () => {
    expect(timeUsedPct(null, day('2026-11-30'), '2026-11-20', TZ)).toBeNull();
    expect(timeUsedPct(day('2026-11-10'), null, '2026-11-20', TZ)).toBeNull();
    expect(timeUsedPct(day('2026-11-10'), day('2026-11-10'), '2026-11-20', TZ)).toBeNull();
  });
});
