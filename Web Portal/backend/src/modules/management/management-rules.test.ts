import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  NO_ACTIVITY_DAYS,
  completionPct,
  firstWorkingDay,
  healthOrder,
  passRate,
  periodOf,
  projectRag,
  trendWeeks,
  type HealthFacts,
} from './management-rules';

const TZ = 'Asia/Muscat';
// Tuesday 27 October 2026, 10:00 in Muscat.
const NOW = new Date('2026-10-27T06:00:00.000Z');
const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  status: 'ACTIVE',
  open: 10,
  late: 0,
  lateMilestones: [],
  missingChecks: 0,
  lastActivityAt: new Date('2026-10-26T08:00:00.000Z'),
  ...over,
});
const rag = (over: Partial<HealthFacts>) => projectRag(facts(over), { now: NOW, timeZone: TZ });

describe('projectRag: red / amber / green with the reasons in words', () => {
  it('is green with nothing wrong, and says so', () => {
    expect(rag({})).toEqual({ rag: 'GREEN', reasons: [{ code: 'ON_TRACK', level: 'GREEN', text: 'On track' }] });
  });

  it('is red when a milestone is overdue and not done (one named, several counted)', () => {
    expect(rag({ lateMilestones: [{ title: 'Beta build', daysLate: 3 }] })).toEqual({
      rag: 'RED',
      reasons: [{ code: 'MILESTONE_LATE', level: 'RED', text: 'Milestone “Beta build” is 3 days late' }],
    });
    expect(rag({ lateMilestones: [{ title: 'A', daysLate: 1 }] }).reasons[0]!.text).toBe('Milestone “A” is 1 day late');
    expect(rag({ lateMilestones: [{ title: 'A', daysLate: 1 }, { title: 'B', daysLate: 9 }] }).reasons[0]!.text).toBe('2 milestones are late');
  });

  it('is red when late tasks are at least 25% of the open ones and at least 3 are late', () => {
    expect(rag({ open: 12, late: 3 })).toMatchObject({ rag: 'RED', reasons: [{ code: 'MANY_LATE', level: 'RED', text: '3 of 12 open tasks are late' }] });
    // 3 of 13 is under a quarter: amber.
    expect(rag({ open: 13, late: 3 })).toMatchObject({ rag: 'AMBER', reasons: [{ code: 'LATE_TASKS', level: 'AMBER', text: '3 late tasks' }] });
    // Half are late, but only 2: amber.
    expect(rag({ open: 4, late: 2 })).toMatchObject({ rag: 'AMBER', reasons: [{ code: 'LATE_TASKS', text: '2 late tasks' }] });
    expect(rag({ open: 5, late: 1 }).reasons[0]!.text).toBe('1 late task');
  });

  it('is red from 3 missing checks; amber with 1 or 2', () => {
    expect(rag({ missingChecks: 3 })).toMatchObject({ rag: 'RED', reasons: [{ code: 'MANY_MISSING_CHECKS', level: 'RED', text: '3 missing checks' }] });
    expect(rag({ missingChecks: 2 })).toMatchObject({ rag: 'AMBER', reasons: [{ code: 'MISSING_CHECKS', level: 'AMBER', text: '2 missing checks' }] });
    expect(rag({ missingChecks: 1 }).reasons[0]!.text).toBe('1 missing check');
  });

  it(`is amber when an ACTIVE project has had no activity for ${NO_ACTIVITY_DAYS} days (company days), never for other statuses`, () => {
    // Last change 13 October (Muscat): 14 days before 27 October.
    const idle = new Date('2026-10-13T05:00:00.000Z');
    expect(rag({ lastActivityAt: idle })).toMatchObject({ rag: 'AMBER', reasons: [{ code: 'NO_ACTIVITY', level: 'AMBER', text: 'No activity for 14 days' }] });
    // 14 October: 13 days — still fine.
    expect(rag({ lastActivityAt: new Date('2026-10-14T05:00:00.000Z') }).rag).toBe('GREEN');
    // 13 October 23:30 in Muscat is still the 13th there (19:30 UTC).
    expect(rag({ lastActivityAt: new Date('2026-10-13T19:30:00.000Z') }).rag).toBe('AMBER');
    for (const status of ['PLANNING', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const) expect(rag({ status, lastActivityAt: idle }).rag).toBe('GREEN');
  });

  it('lists every reason that applies, the red ones first', () => {
    const r = rag({ open: 20, late: 2, missingChecks: 4, lateMilestones: [{ title: 'Handover', daysLate: 2 }], lastActivityAt: new Date('2026-09-01T05:00:00.000Z') });
    expect(r.rag).toBe('RED');
    expect(r.reasons.map((x) => [x.code, x.level])).toEqual([
      ['MILESTONE_LATE', 'RED'],
      ['MANY_MISSING_CHECKS', 'RED'],
      ['LATE_TASKS', 'AMBER'],
      ['NO_ACTIVITY', 'AMBER'],
    ]);
  });
});

describe('healthOrder: red, amber, green; then the most late tasks; then the name', () => {
  it('sorts the project-health rows', () => {
    const rows = [
      { name: 'Bravo', rag: 'GREEN' as const, late: 0 },
      { name: 'Alpha', rag: 'AMBER' as const, late: 1 },
      { name: 'Delta', rag: 'RED' as const, late: 2 },
      { name: 'Charlie', rag: 'RED' as const, late: 5 },
      { name: 'Echo', rag: 'AMBER' as const, late: 1 },
      { name: 'alpha two', rag: 'GREEN' as const, late: 0 },
    ];
    expect([...rows].sort(healthOrder).map((r) => r.name)).toEqual(['Charlie', 'Delta', 'Alpha', 'Echo', 'alpha two', 'Bravo']);
  });
});

describe('completionPct: the project dashboard’s “Completion” (share of tasks finished)', () => {
  it('rounds the share of done tasks; 0 with no tasks', () => {
    expect(completionPct(0, 0)).toBe(0);
    expect(completionPct(1, 3)).toBe(33);
    expect(completionPct(2, 3)).toBe(67);
    expect(completionPct(4, 4)).toBe(100);
  });

  const web = resolve(__dirname, '../../../../frontend/src/lib/project-dashboard.ts');
  it.skipIf(!existsSync(web))('is the same number as the project page’s Completion tile (frontend lib/project-dashboard taskStats().pct)', async () => {
    const { taskStats } = (await import(pathToFileURL(web).href)) as { taskStats: (tasks: unknown[], today: string, tz: string) => { pct: number; completed: number } };
    const t = (done: boolean, i: number) => ({ id: String(i), columnCategory: done ? 'DONE' : 'TODO', completedAt: null, dueDate: null, progress: 50, priority: 'NORMAL', assignees: [] });
    for (const [done, total] of [[0, 0], [1, 3], [2, 3], [5, 7], [7, 7], [1, 8], [3, 8]] as const) {
      const tasks = Array.from({ length: total }, (_, i) => t(i < done, i));
      expect(completionPct(done, total), `${done}/${total}`).toBe(taskStats(tasks, '2026-10-27', TZ).pct);
    }
  });
});

describe('passRate: passed ÷ (passed + failed), as a whole percent', () => {
  it('is null with nothing answered, else rounded', () => {
    expect(passRate(0, 0)).toBeNull();
    expect(passRate(9, 1)).toBe(90);
    expect(passRate(2, 1)).toBe(67);
    expect(passRate(0, 4)).toBe(0);
  });
});

describe('firstWorkingDay: the first working morning of a company week', () => {
  const SUN_THU = [0, 1, 2, 3, 4];
  const MON_FRI = [1, 2, 3, 4, 5];
  it('is the week’s first day when that is a working day, else the next working day', () => {
    expect(firstWorkingDay('2026-10-25', SUN_THU)).toBe('2026-10-25'); // Sunday week, Sunday works
    expect(firstWorkingDay('2026-10-26', SUN_THU)).toBe('2026-10-26'); // Monday week
    expect(firstWorkingDay('2026-10-24', SUN_THU)).toBe('2026-10-25'); // Saturday week: Sunday
    expect(firstWorkingDay('2026-10-25', MON_FRI)).toBe('2026-10-26'); // Sunday week, Monday–Friday
  });
});

describe('trendWeeks / periodOf: company weeks in the company time zone, the current one last (partial)', () => {
  it('ends with the week today is in, for a week that starts on Sunday or on Monday', () => {
    const sun = trendWeeks({ now: NOW, timeZone: TZ, weekStart: 0, weeks: 4 });
    expect(sun.map((w) => w.start)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
    const mon = trendWeeks({ now: NOW, timeZone: TZ, weekStart: 1, weeks: 4 });
    expect(mon.map((w) => w.start)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(mon.map((w) => w.current)).toEqual([false, false, false, true]);
    expect(trendWeeks({ now: NOW, timeZone: TZ, weekStart: 0, weeks: 26 })).toHaveLength(26);
  });

  it('starts and ends each week at company midnight; a past week is judged at its end, the current one now', () => {
    const [first, , , last] = trendWeeks({ now: NOW, timeZone: TZ, weekStart: 0, weeks: 4 });
    expect(first!.from.toISOString()).toBe('2026-10-03T20:00:00.000Z'); // 4 October 00:00 in Muscat
    expect(first!.to.toISOString()).toBe('2026-10-10T20:00:00.000Z');
    expect(first!.end).toBe('2026-10-10');
    expect(first!.lateOn).toBe('2026-10-10'); // late as of the week's last day
    expect(first!.lateAt.toISOString()).toBe('2026-10-10T20:00:00.000Z');
    expect(last!.lateOn).toBe('2026-10-27'); // today
    expect(last!.lateAt.toISOString()).toBe(NOW.toISOString());
    expect(first!.label).toBe('4 Oct');
  });

  it('knows today’s week from the company day, not the UTC day', () => {
    // Saturday 24 October 21:00 UTC is Sunday 25 October 01:00 in Muscat: a new Sunday week.
    const weeks = trendWeeks({ now: new Date('2026-10-24T21:00:00.000Z'), timeZone: TZ, weekStart: 0, weeks: 4 });
    expect(weeks.at(-1)!.start).toBe('2026-10-25');
    expect(trendWeeks({ now: new Date('2026-10-24T19:00:00.000Z'), timeZone: TZ, weekStart: 0, weeks: 4 }).at(-1)!.start).toBe('2026-10-18');
  });

  it('the period runs from the first week’s first day to today', () => {
    expect(periodOf({ now: NOW, timeZone: TZ, weekStart: 0, weeks: 12 })).toEqual({ from: '2026-08-09', to: '2026-10-27', weeks: 12 });
    expect(periodOf({ now: NOW, timeZone: TZ, weekStart: 1, weeks: 4 })).toEqual({ from: '2026-10-05', to: '2026-10-27', weeks: 4 });
  });
});
