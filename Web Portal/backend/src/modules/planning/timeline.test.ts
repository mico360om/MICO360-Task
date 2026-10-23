import { describe, it, expect } from 'vitest';
import { buildTimeline, progressPct, projectHealth, timelineRange, weekOf, type TimelineRows } from './timeline';
import type { ProjectRecord } from '../projects/project-repository';

const project = (id: string, extra: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id,
  code: id.toUpperCase(),
  number: null,
  name: `Project ${id}`,
  description: null,
  clientName: null,
  managerId: null,
  carryForward: true,
  defaultDueToday: false,
  ownerId: null,
  status: 'ACTIVE',
  priority: 'NORMAL',
  color: '#2F6FAE',
  icon: null,
  imageUrl: null,
  startDate: null,
  targetDate: null,
  notes: null,
  createdById: 'admin',
  createdAt: new Date('2026-09-01T08:00:00Z'),
  updatedAt: new Date('2026-10-01T08:00:00Z'),
  ...extra,
});

const empty: TimelineRows = { totals: [], openByDue: [], milestones: [], nextMilestones: [], soonMilestones: [], milestoneCounts: [], meetings: [], meetingsThisWeek: [], owners: [] };
// Saturday 24 October 2026, 12:00 in Muscat.
const now = new Date('2026-10-24T08:00:00Z');
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const range = timelineRange('2026-10-19', '2026-11-08', 1)!;
const opts = { timeZone: 'Asia/Muscat', now, range, weekStart: 1 as const };

describe('progressPct', () => {
  it('rounds as the Projects page does, 99 until every task is done', () => {
    expect(progressPct(0, 0)).toBe(0);
    expect(progressPct(11, 1)).toBe(9);
    expect(progressPct(40, 25)).toBe(63);
    expect(progressPct(200, 199)).toBe(99);
    expect(progressPct(3, 3)).toBe(100);
  });
});

describe('timelineRange and weekOf', () => {
  it('widens the asked days to whole weeks starting on the given day', () => {
    expect(timelineRange('2026-10-07', '2026-10-30', 1)).toEqual({
      from: '2026-10-05',
      to: '2026-11-01',
      weeks: ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'],
    });
    // Sunday weeks, and Saturday weeks.
    expect(timelineRange('2026-10-24', '2026-10-24', 0)).toEqual({ from: '2026-10-18', to: '2026-10-24', weeks: ['2026-10-18'] });
    expect(timelineRange('2026-10-24', '2026-10-25', 6)).toEqual({ from: '2026-10-24', to: '2026-10-30', weeks: ['2026-10-24'] });
  });

  it('refuses a reversed range and one longer than 53 weeks', () => {
    expect(timelineRange('2026-10-30', '2026-10-01', 1)).toBeNull();
    expect(timelineRange('2026-01-05', '2027-01-10', 1)?.weeks).toHaveLength(53);
    expect(timelineRange('2026-01-05', '2027-01-11', 1)).toBeNull();
  });

  it('finds the first day of the week a day is in', () => {
    expect(weekOf('2026-10-24', 0)).toBe('2026-10-18');
    expect(weekOf('2026-10-24', 1)).toBe('2026-10-19');
    expect(weekOf('2026-10-24', 6)).toBe('2026-10-24');
  });
});

describe('projectHealth', () => {
  const today = '2026-10-24';
  it('is at risk when 20 points or more less is done than the share of time used', () => {
    // 4 Oct → 3 Nov is 30 days; 20 have gone: 67% of the time used.
    expect(projectHealth({ start: '2026-10-04', target: '2026-11-03', today, progress: 47 })).toEqual({ health: 'at-risk', timeUsed: 67, daysLate: 0 });
    expect(projectHealth({ start: '2026-10-04', target: '2026-11-03', today, progress: 48 })).toEqual({ health: 'on-track', timeUsed: 67, daysLate: 0 });
  });

  it('is late once the target day has passed, counting the days', () => {
    expect(projectHealth({ start: '2026-09-01', target: '2026-10-21', today, progress: 85 })).toEqual({ health: 'late', timeUsed: 100, daysLate: 3 });
  });

  it('is not late on the target day itself', () => {
    expect(projectHealth({ start: '2026-09-24', target: today, today, progress: 85 })).toEqual({ health: 'on-track', timeUsed: 100, daysLate: 0 });
    expect(projectHealth({ start: '2026-09-24', target: today, today, progress: 79 }).health).toBe('at-risk');
  });

  it('uses no time before the start', () => {
    expect(projectHealth({ start: '2026-11-01', target: '2026-12-01', today, progress: 0 })).toEqual({ health: 'on-track', timeUsed: 0, daysLate: 0 });
  });

  it('has no status against dates without a target', () => {
    expect(projectHealth({ start: '2026-10-01', target: null, today, progress: 10 })).toEqual({ health: 'no-target', timeUsed: null, daysLate: 0 });
  });
});

describe('buildTimeline', () => {
  it('gives each project its bar: start (else the day it was created, company time), target, progress and status', () => {
    const rows: TimelineRows = {
      ...empty,
      totals: [{ projectId: 'mob', total: 11 }, { projectId: 'fcrm', total: 20 }],
      openByDue: [
        { projectId: 'mob', dueDate: null, count: 10 },
        { projectId: 'fcrm', dueDate: null, count: 3 },
      ],
    };
    const data = buildTimeline(
      [
        project('mob', { startDate: day('2026-10-01'), targetDate: day('2026-12-10') }),
        // Created 01:30 on 1 October in Muscat — still 30 September in UTC.
        project('fcrm', { createdAt: new Date('2026-09-30T21:30:00Z'), targetDate: day('2026-10-21') }),
        project('mssp'),
      ],
      rows,
      opts,
    );
    const [mob, fcrm, mssp] = data.projects;
    expect(mob).toMatchObject({ start: '2026-10-01', startIsCreated: false, target: '2026-12-10', progress: 9, timeUsed: 33, health: 'at-risk', daysLate: 0 });
    expect(fcrm).toMatchObject({ start: '2026-10-01', startIsCreated: true, target: '2026-10-21', progress: 85, timeUsed: 100, health: 'late', daysLate: 3 });
    expect(mssp).toMatchObject({ start: '2026-09-01', target: null, progress: 0, timeUsed: null, health: 'no-target' });
  });

  it('counts done, open and overdue tasks, judging overdue by the company’s today', () => {
    const rows: TimelineRows = {
      ...empty,
      totals: [{ projectId: 'p1', total: 10 }],
      openByDue: [
        { projectId: 'p1', dueDate: day('2026-10-20'), count: 2 },
        // 03:00 on 24 October in Muscat: due today, not overdue.
        { projectId: 'p1', dueDate: new Date('2026-10-23T23:00:00Z'), count: 1 },
        { projectId: 'p1', dueDate: day('2026-10-23'), count: 1 },
        { projectId: 'p1', dueDate: null, count: 2 },
      ],
    };
    const [p] = buildTimeline([project('p1')], rows, opts).projects;
    expect(p!.tasks).toEqual({ total: 10, done: 4, open: 6, overdue: 3 });
  });

  it('counts each shown week’s open tasks due, per project (busy weeks)', () => {
    const rows: TimelineRows = {
      ...empty,
      openByDue: [
        { projectId: 'p1', dueDate: day('2026-10-18'), count: 2 }, // the Sunday before the first week: not shown
        { projectId: 'p1', dueDate: day('2026-10-20'), count: 2 },
        { projectId: 'p1', dueDate: day('2026-10-25'), count: 1 }, // Sunday: the end of the first (Monday) week
        { projectId: 'p1', dueDate: day('2026-10-26'), count: 3 },
        { projectId: 'p1', dueDate: new Date('2026-11-01T21:00:00Z'), count: 1 }, // 01:00 on 2 November in Muscat
        { projectId: 'p1', dueDate: day('2026-11-09'), count: 5 }, // after the last week
        { projectId: 'p1', dueDate: null, count: 4 },
        { projectId: 'p2', dueDate: day('2026-11-08'), count: 7 },
      ],
    };
    const data = buildTimeline([project('p1'), project('p2')], rows, opts);
    expect(data.weeks).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(data.projects.map((p) => p.dueByWeek)).toEqual([
      [3, 3, 1],
      [0, 0, 7],
    ]);
  });

  const ms = (id: string, dueDate: Date | null, done = false, projectId = 'p1') => ({ id, key: `MOB-${id}`, title: `Milestone ${id}`, projectId, dueDate, done });

  it('marks the shown weeks’ milestones by date, filled once reached; the next one, the 30-day count and the total come from their own reads', () => {
    const rows: TimelineRows = {
      ...empty,
      milestones: [ms('beta', day('2026-11-06')), ms('design', day('2026-10-20')), ms('kickoff', day('2026-10-21'), true), ms('far', day('2026-12-01'))],
      nextMilestones: [ms('design', day('2026-10-20'))],
      soonMilestones: [
        { projectId: 'p1', dueDate: day('2026-11-06') },
        { projectId: 'p1', dueDate: day('2026-11-24') }, // 31 days on: not counted
        { projectId: 'p1', dueDate: day('2026-10-23') }, // yesterday: not counted
      ],
      milestoneCounts: [{ projectId: 'p1', count: 7 }],
    };
    const [p] = buildTimeline([project('p1')], rows, opts).projects;
    // Only the shown weeks' (19 Oct – 8 Nov) are markers.
    expect(p!.milestones.map((m) => [m.id, m.date, m.done])).toEqual([
      ['design', '2026-10-20', false],
      ['kickoff', '2026-10-21', true],
      ['beta', '2026-11-06', false],
    ]);
    expect(p!.nextMilestone).toMatchObject({ id: 'design', title: 'Milestone design', date: '2026-10-20' });
    expect(p!.milestonesSoon).toBe(1);
    expect(p!.milestoneCount).toBe(7);
  });

  it('takes the earliest dated milestone not reached as the next one (by title on the same day), else an undated one', () => {
    const rows: TimelineRows = {
      ...empty,
      nextMilestones: [ms('zeta', day('2026-11-01')), ms('alpha', day('2026-11-01')), ms('loose', null), ms('undated', null, false, 'p2')],
      milestoneCounts: [{ projectId: 'p1', count: 3 }, { projectId: 'p2', count: 1 }],
    };
    const [p1, p2] = buildTimeline([project('p1'), project('p2')], rows, opts).projects;
    expect(p1!.nextMilestone?.id).toBe('alpha');
    expect(p2!.nextMilestone).toMatchObject({ id: 'undated', date: null });
  });

  it('has no next milestone when every one is reached', () => {
    const rows: TimelineRows = { ...empty, milestoneCounts: [{ projectId: 'p1', count: 1 }] };
    const [p] = buildTimeline([project('p1')], rows, opts).projects;
    expect(p!.nextMilestone).toBeNull();
    expect(p!.milestoneCount).toBe(1);
  });

  it('puts the shown weeks’ meetings on their company-time day, and takes this week’s count from its own read', () => {
    // The chart shows 2–15 November; this week (19–25 October) is not among the shown weeks.
    const later = timelineRange('2026-11-02', '2026-11-15', 1)!;
    const rows: TimelineRows = {
      ...empty,
      meetings: [
        { id: 'm2', title: 'Pilot review', projectId: 'p1', startAt: new Date('2026-11-03T21:30:00Z'), endAt: null }, // 01:30 on 4 Nov in Muscat
        { id: 'm3', title: 'Other project', projectId: 'p2', startAt: new Date('2026-11-05T06:00:00Z'), endAt: null },
        { id: 'm4', title: 'Too late', projectId: 'p2', startAt: new Date('2026-11-20T06:00:00Z'), endAt: null },
      ],
      meetingsThisWeek: [{ projectId: 'p1', count: 1 }],
    };
    const [p1, p2] = buildTimeline([project('p1'), project('p2')], rows, { ...opts, range: later }).projects;
    expect(p1!.meetings).toEqual([{ id: 'm2', title: 'Pilot review', startAt: new Date('2026-11-03T21:30:00Z'), day: '2026-11-04' }]);
    expect(p1!.meetingsThisWeek).toBe(1);
    expect(p2!.meetings.map((m) => m.id)).toEqual(['m3']);
    expect(p2!.meetingsThisWeek).toBe(0);
  });

  it('names each project’s owner and gives the range, today and the current week', () => {
    const sara = { id: 'u1', name: 'Sara Ahmed', avatarUrl: null };
    const data = buildTimeline([project('p1', { ownerId: 'u1' }), project('p2', { ownerId: 'gone' })], { ...empty, owners: [sara] }, opts);
    expect(data.projects.map((p) => p.owner)).toEqual([sara, null]);
    expect(data).toMatchObject({ from: '2026-10-19', to: '2026-11-08', weekStart: 1, today: '2026-10-24', currentWeek: '2026-10-19' });
  });

  it('keeps each project’s own look and the order given', () => {
    const data = buildTimeline([project('b', { name: 'Beta', color: '#7A5AA8', icon: 'rocket' }), project('a')], empty, opts);
    expect(data.projects.map((p) => p.id)).toEqual(['b', 'a']);
    expect(data.projects[0]).toMatchObject({ code: 'B', name: 'Beta', color: '#7A5AA8', icon: 'rocket', imageUrl: null, status: 'ACTIVE' });
  });
});
