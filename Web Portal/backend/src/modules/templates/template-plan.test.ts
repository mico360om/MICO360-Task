import { describe, it, expect } from 'vitest';
import { dueDayFor, offsetBetween, planTemplateTasks, startColumnIndex, weekdayOf } from './template-plan';

// The company's default working week: Sunday to Thursday (Friday and Saturday off).
const SUN_THU = [0, 1, 2, 3, 4];

describe('due offsets: calendar days from the start, moved off days off', () => {
  it('counts calendar days from the start day (0 = the start day itself)', () => {
    // Sunday 1 Nov 2026.
    expect(weekdayOf('2026-11-01')).toBe(0);
    expect(dueDayFor('2026-11-01', 0, SUN_THU)).toEqual({ day: '2026-11-01', movedFrom: null });
    expect(dueDayFor('2026-11-01', 3, SUN_THU)).toEqual({ day: '2026-11-04', movedFrom: null });
    expect(dueDayFor('2026-11-01', 14, SUN_THU)).toEqual({ day: '2026-11-15', movedFrom: null });
  });

  it('moves a due day that falls on a day off to the next working day', () => {
    // Start + 5 = Friday 6 Nov → Sunday 8 Nov; start + 6 = Saturday → Sunday too.
    expect(dueDayFor('2026-11-01', 5, SUN_THU)).toEqual({ day: '2026-11-08', movedFrom: '2026-11-06' });
    expect(dueDayFor('2026-11-01', 6, SUN_THU)).toEqual({ day: '2026-11-08', movedFrom: '2026-11-07' });
  });

  it('follows the company’s own working days (a Monday–Friday week)', () => {
    const MON_FRI = [1, 2, 3, 4, 5];
    // Start + 5 = Friday: a working day here.
    expect(dueDayFor('2026-11-01', 5, MON_FRI)).toEqual({ day: '2026-11-06', movedFrom: null });
    // Start + 0 on a Sunday → Monday.
    expect(dueDayFor('2026-11-01', 0, MON_FRI)).toEqual({ day: '2026-11-02', movedFrom: '2026-11-01' });
  });

  it('follows a Saturday–Wednesday week (Thursday and Friday off)', () => {
    const SAT_WED = [6, 0, 1, 2, 3];
    // Sunday 1 Nov: + 4 = Thursday → Saturday 7 Nov; + 5 = Friday → Saturday; + 6 = Saturday, a working day.
    expect(dueDayFor('2026-11-01', 4, SAT_WED)).toEqual({ day: '2026-11-07', movedFrom: '2026-11-05' });
    expect(dueDayFor('2026-11-01', 5, SAT_WED)).toEqual({ day: '2026-11-07', movedFrom: '2026-11-06' });
    expect(dueDayFor('2026-11-01', 6, SAT_WED)).toEqual({ day: '2026-11-07', movedFrom: null });
    expect(dueDayFor('2026-11-01', 3, SAT_WED)).toEqual({ day: '2026-11-04', movedFrom: null });
  });

  it('a start on a day off still counts from that day', () => {
    // Saturday 7 Nov + 1 = Sunday 8 Nov (a working day).
    expect(dueDayFor('2026-11-07', 1, SUN_THU)).toEqual({ day: '2026-11-08', movedFrom: null });
  });

  it('allows due days before the start (a negative offset)', () => {
    expect(dueDayFor('2026-11-04', -2, SUN_THU)).toEqual({ day: '2026-11-02', movedFrom: null });
  });

  it('no offset means no due date', () => {
    expect(dueDayFor('2026-11-01', null, SUN_THU)).toEqual({ day: null, movedFrom: null });
  });

  it('with no working days set at all, nothing moves', () => {
    expect(dueDayFor('2026-11-01', 5, [])).toEqual({ day: '2026-11-06', movedFrom: null });
  });

  it('crosses month and year ends', () => {
    expect(dueDayFor('2026-12-28', 5, SUN_THU)).toEqual({ day: '2027-01-03', movedFrom: '2027-01-02' });
    expect(dueDayFor('2028-02-27', 2, [0, 1, 2, 3, 4, 5, 6])).toEqual({ day: '2028-02-29', movedFrom: null });
  });
});

describe('offsets when a project is saved as a template', () => {
  it('is the whole days from the base day to the due day', () => {
    expect(offsetBetween('2026-11-01', '2026-11-06')).toBe(5);
    expect(offsetBetween('2026-11-01', '2026-11-01')).toBe(0);
    expect(offsetBetween('2026-11-04', '2026-11-02')).toBe(-2);
    expect(offsetBetween('2026-03-01', '2026-03-31')).toBe(30);
  });
  it('no due day: no offset', () => {
    expect(offsetBetween('2026-11-01', null)).toBeNull();
  });
  it('round-trips: a due day on a working day comes back on the same day', () => {
    for (const due of ['2026-11-03', '2026-11-12', '2026-12-31']) {
      expect(dueDayFor('2026-11-01', offsetBetween('2026-11-01', due), SUN_THU).day).toBe(due);
    }
  });
});

describe('the column tasks start in', () => {
  it('is the first To Do column', () => {
    expect(startColumnIndex([{ category: 'BACKLOG' }, { category: 'TODO' }, { category: 'DONE' }])).toBe(1);
  });
  it('else the first column that isn’t Done', () => {
    expect(startColumnIndex([{ category: 'DONE' }, { category: 'IN_PROGRESS' }, { category: 'REVIEW' }])).toBe(1);
  });
  it('else the first column', () => {
    expect(startColumnIndex([{ category: 'DONE' }])).toBe(0);
  });
});

describe('planning a template’s tasks for a start day', () => {
  const template = {
    roles: [{ id: 'r-insp', name: 'Inspector' }, { id: 'r-lead', name: 'Site lead' }],
    tasks: [
      { title: 'Kick-off', description: null, priority: 'HIGH' as const, dueOffsetDays: 0, roleId: 'r-lead', checklist: ['Agenda', 'Attendees'] },
      { title: 'Inspect', description: 'Walk the site', priority: 'NORMAL' as const, dueOffsetDays: 5, roleId: 'r-insp', checklist: [] },
      { title: 'Report', description: null, priority: 'LOW' as const, dueOffsetDays: null, roleId: null, checklist: [] },
    ],
  };

  it('gives each task its due day and the person filling its role (nobody: the usual default)', () => {
    const plan = planTemplateTasks(template, { startKey: '2026-11-01', workingDays: SUN_THU, fillers: { 'r-insp': 'u-omar' } });
    expect(plan.map((t) => [t.title, t.dueDay, t.movedFrom, t.assigneeId, t.roleName])).toEqual([
      ['Kick-off', '2026-11-01', null, null, 'Site lead'],
      ['Inspect', '2026-11-08', '2026-11-06', 'u-omar', 'Inspector'],
      ['Report', null, null, null, null],
    ]);
    expect(plan[0]).toMatchObject({ priority: 'HIGH', checklist: ['Agenda', 'Attendees'], description: null });
  });

  it('one person can fill several roles', () => {
    const plan = planTemplateTasks(template, { startKey: '2026-11-01', workingDays: SUN_THU, fillers: { 'r-insp': 'u-sara', 'r-lead': 'u-sara' } });
    expect(plan.map((t) => t.assigneeId)).toEqual(['u-sara', 'u-sara', null]);
  });

  it('plans 500 tasks quickly', () => {
    const many = { roles: [], tasks: Array.from({ length: 500 }, (_, i) => ({ title: `T${i}`, description: null, priority: 'NORMAL' as const, dueOffsetDays: i, roleId: null, checklist: ['a', 'b'] })) };
    const t0 = performance.now();
    const plan = planTemplateTasks(many, { startKey: '2026-11-01', workingDays: SUN_THU, fillers: {} });
    expect(plan).toHaveLength(500);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
