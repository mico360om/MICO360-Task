import { describe, expect, it } from 'vitest';
import { countWindow, countResponses, emptyCounters, addCounters, projectFigures, userFigures, windowOf, type CalcContext, type Conversation } from './kpi-calc';
import type { HistoryEvent, KpiTask } from './task-history';
import type { WorkCalendar } from '../../lib/working-days';

const TZ = 'Asia/Muscat';
const at = (day: string, hhmm = '10:00') => new Date(`${day}T${hhmm}:00+04:00`);
const dueAt = (day: string) => new Date(`${day}T12:00:00.000Z`);
const ev = (day: string, action: string, userId: string, meta: unknown = {}, hhmm = '10:00'): HistoryEvent => ({ at: at(day, hhmm), action, userId, meta });
const CAL: WorkCalendar = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
const HOURS = { start: '08:00', end: '17:00' };
const WEIGHTS = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 };

const ctx: CalcContext = {
  timeZone: TZ,
  project: () => ({ calendar: CAL, hours: HOURS, weights: WEIGHTS, rules: { isAdmin: (id) => id === 'boss', runsProject: (id) => id === 'mgr' || id === 'boss' } }),
};

let n = 0;
function task(over: Partial<KpiTask> = {}): KpiTask {
  n += 1;
  return {
    id: `t${n}`,
    key: `P-${n}`,
    title: `Task ${n}`,
    projectId: 'p1',
    createdAt: at('2026-10-01', '08:00'),
    updatedAt: at('2026-10-01', '08:00'),
    startDate: null,
    dueDate: null,
    completedAt: null,
    columnCategory: 'TODO',
    approvalRequestedAt: null,
    priority: 'NORMAL',
    weight: null,
    assignees: [{ userId: 'ann', assignedAt: at('2026-10-01', '08:00') }],
    events: [],
    ...over,
  };
}
const done = (day: string, over: Partial<KpiTask> = {}) => task({ columnCategory: 'DONE', completedAt: at(day), ...over });

// November 2026 (Sunday–Thursday weeks); "today" is Wed 11 Nov.
const NOV = windowOf('2026-11-01', '2026-11-11', TZ, at('2026-11-11', '15:00'));

describe('countWindow — project counters', () => {
  it('on time, late, average working days late (against the agreed due day)', () => {
    const tasks = [
      done('2026-11-03', { dueDate: dueAt('2026-11-04') }), // early
      done('2026-11-04', { dueDate: dueAt('2026-11-04') }), // on the day
      done('2026-11-09', { dueDate: dueAt('2026-11-05') }), // Thu → Mon: 2 working days late (Sun, Mon)
      done('2026-11-10'), // no due date: completed, not judged
      done('2026-10-20', { dueDate: dueAt('2026-10-20') }), // before the period
    ];
    const p = countWindow(tasks, NOV, ctx).projects.get('p1')!;
    expect(p.completed).toBe(4);
    expect(p.dueDone).toBe(3);
    expect(p.onTime).toBe(2);
    expect(p.lateCount).toBe(1);
    expect(p.lateDays).toBe(2);
    const f = projectFigures(p, { weeks: 11 / 7, blocked: 0, progress: null });
    expect(f.onTime).toBe(67);
    expect(f.daysLate).toBe(2);
  });

  it('an assignee moving the due day later is still judged against the agreed one', () => {
    const t = done('2026-11-09', { dueDate: dueAt('2026-11-10'), events: [ev('2026-11-04', 'UPDATED', 'ann', { changes: [{ field: 'dueDate', from: '2026-11-05', to: '2026-11-10' }] })] });
    const p = countWindow([t], NOV, ctx).projects.get('p1')!;
    expect(p.onTime).toBe(0);
    expect(p.lateCount).toBe(1);
  });

  it('a task handed in for approval counts as done when handed in', () => {
    const t = task({ columnCategory: 'REVIEW', dueDate: dueAt('2026-11-05'), approvalRequestedAt: at('2026-11-05', '16:00') });
    const p = countWindow([t], NOV, ctx).projects.get('p1')!;
    expect(p.completed).toBe(1);
    expect(p.onTime).toBe(1);
  });

  it('overdue at the end of the window: open tasks past the agreed due day, of open ones with one', () => {
    const tasks = [task({ dueDate: dueAt('2026-11-09') }), task({ dueDate: dueAt('2026-11-20') }), task(), task({ dueDate: dueAt('2026-11-11') })];
    const p = countWindow(tasks, NOV, ctx).projects.get('p1')!;
    expect(p.openDue).toBe(3);
    expect(p.overdue).toBe(1); // due today is not overdue
    expect(projectFigures(p, { weeks: 1, blocked: 0, progress: null }).overdue).toBe(33);
  });

  it('cycle time: working days from the start (else creation) to done', () => {
    const tasks = [done('2026-11-05', { startDate: dueAt('2026-11-01') }), done('2026-11-04', { createdAt: at('2026-11-02') })];
    const p = countWindow(tasks, NOV, ctx).projects.get('p1')!;
    expect(p.cycleCount).toBe(2);
    expect(p.cycleDays).toBe(4 + 2);
    expect(projectFigures(p, { weeks: 1, blocked: 0, progress: null }).cycleTime).toBe(3);
  });

  it('approval turnaround: working hours from hand-in to decision, in the period of the decision', () => {
    const t = done('2026-11-08', {
      events: [ev('2026-11-05', 'APPROVAL_REQUESTED', 'ann', {}, '16:00'), ev('2026-11-08', 'APPROVED', 'mgr', {}, '09:00')],
    });
    const p = countWindow([t], NOV, ctx).projects.get('p1')!;
    expect(p.approvalCount).toBe(1);
    expect(p.approvalHours).toBe(2); // Thu 16–17 + Sun 08–09
  });

  it('throughput: tasks finished per week over the period', () => {
    const p = countWindow([done('2026-11-02'), done('2026-11-03'), done('2026-11-09')], NOV, ctx).projects.get('p1')!;
    expect(projectFigures(p, { weeks: 2, blocked: 0, progress: null }).throughput).toBe(1.5);
  });

  it('no data: null figures, not zeros', () => {
    const f = projectFigures(emptyCounters(), { weeks: 1, blocked: 0, progress: null });
    expect(f.onTime).toBeNull();
    expect(f.overdue).toBeNull();
    expect(f.daysLate).toBeNull();
    expect(f.cycleTime).toBeNull();
    expect(f.approvalTurnaround).toBeNull();
    expect(f.throughput).toBe(0);
  });

  it('nothing finished late (but some on time): 0 days late', () => {
    const p = countWindow([done('2026-11-03', { dueDate: dueAt('2026-11-04') })], NOV, ctx).projects.get('p1')!;
    expect(projectFigures(p, { weeks: 1, blocked: 0, progress: null }).daysLate).toBe(0);
  });

  it('completion at the end of the window: tasks (and weights) existing then, done by then', () => {
    const tasks = [done('2026-11-03', { priority: 'URGENT' }), task({ priority: 'LOW' }), task({ createdAt: at('2026-11-20') })];
    const p = countWindow(tasks, NOV, ctx).projects.get('p1')!;
    expect([p.total, p.done, p.weightTotal, p.weightDone]).toEqual([2, 1, 5, 4]);
  });

  it('an archived open task leaves every figure; an archived Done task still counts as done', () => {
    const tasks = [done('2026-11-03', { dueDate: dueAt('2026-11-04'), archivedAt: at('2026-11-05') }), task({ dueDate: dueAt('2026-11-02'), archivedAt: at('2026-11-05') })];
    const p = countWindow(tasks, NOV, ctx).projects.get('p1')!;
    expect(p.completed).toBe(1);
    expect(p.onTime).toBe(1);
    expect(p.openDue).toBe(0);
    expect(p.total).toBe(1);
  });
});

describe('countWindow — people (call 2)', () => {
  it('"completed" counts for everyone on it at completion; several assignees each count in full', () => {
    const t = done('2026-11-04', { assignees: [{ userId: 'ann', assignedAt: at('2026-10-01') }, { userId: 'bob', assignedAt: at('2026-10-01') }] });
    const people = countWindow([t], NOV, ctx).people.get('p1')!;
    expect(people.get('ann')!.completed).toBe(1);
    expect(people.get('bob')!.completed).toBe(1);
  });

  it('a late task handed on after its due day counts late for who had it on the day, completed for who finished it', () => {
    const t = done('2026-11-10', {
      dueDate: dueAt('2026-11-04'),
      assignees: [{ userId: 'bob', assignedAt: at('2026-11-08') }],
      events: [ev('2026-10-01', 'ASSIGNED', 'mgr', { assigneeId: 'ann' }, '08:00'), ev('2026-11-08', 'UNASSIGNED', 'mgr', { assigneeId: 'ann' }), ev('2026-11-08', 'ASSIGNED', 'mgr', { assigneeId: 'bob' })],
    });
    const people = countWindow([t], NOV, ctx).people.get('p1')!;
    expect(people.get('ann')).toMatchObject({ completed: 0, dueDone: 1, lateCount: 1 });
    expect(people.get('bob')).toMatchObject({ completed: 1, dueDone: 0, lateCount: 0 });
  });

  it('overdue now counts for whoever is on the task at the end', () => {
    const people = countWindow([task({ dueDate: dueAt('2026-11-09') })], NOV, ctx).people.get('p1')!;
    expect(people.get('ann')).toMatchObject({ openDue: 1, overdue: 1 });
  });

  it('approval turnaround counts for the approver', () => {
    const t = done('2026-11-08', { events: [ev('2026-11-05', 'APPROVAL_REQUESTED', 'ann', {}, '16:00'), ev('2026-11-08', 'APPROVED', 'mgr', {}, '09:00')] });
    const people = countWindow([t], NOV, ctx).people.get('p1')!;
    expect(people.get('mgr')).toMatchObject({ approvalCount: 1, approvalHours: 2 });
    expect(people.get('ann')?.approvalCount ?? 0).toBe(0);
  });

  it('user figures: on time %, overdue now, approval turnaround', () => {
    const c = { ...emptyCounters(), completed: 3, dueDone: 2, onTime: 1, lateCount: 1, lateDays: 3, overdue: 2, openDue: 4, approvalCount: 2, approvalHours: 5 };
    const f = userFigures(c, { responses: [1, 3, 10], actionItems: 2, workload: null });
    expect(f).toMatchObject({ completed: 3, onTime: 50, daysLate: 3, userOverdue: 2, approvalTurnaround: 2.5, responsiveness: 3, actionItems: 2, workload: null });
  });

  it('counters add up (slices into a month)', () => {
    const a = { ...emptyCounters(), completed: 1, lateDays: 2, openDue: 3, overdue: 1 };
    const b = { ...emptyCounters(), completed: 2, lateDays: 1, openDue: 5, overdue: 4 };
    // Additive counts add; the point-in-time ones are the later slice's.
    expect(addCounters(a, b)).toMatchObject({ completed: 3, lateDays: 3, openDue: 5, overdue: 4 });
  });
});

describe('countResponses — update responsiveness (call 3)', () => {
  const t = task({ assignees: [{ userId: 'ann', assignedAt: at('2026-10-01') }] });
  const convo = (items: Conversation['items']): Conversation => ({ task: t, items });

  it('others’ comments on their task, answered by their next comment or status change: median working hours', () => {
    const c = convo([
      { at: at('2026-11-02', '09:00'), userId: 'bob', kind: 'comment', mentions: [] },
      { at: at('2026-11-02', '11:00'), userId: 'ann', kind: 'comment', mentions: [] }, // 2 h
      { at: at('2026-11-03', '09:00'), userId: 'mgr', kind: 'comment', mentions: [] },
      { at: at('2026-11-03', '10:00'), userId: 'mgr', kind: 'comment', mentions: [] }, // still the first prompt
      { at: at('2026-11-03', '13:00'), userId: 'ann', kind: 'status', mentions: [] }, // 4 h
    ]);
    const r = countResponses([c], NOV, ctx);
    expect(r.get('p1')!.get('ann')).toEqual([2, 4]);
  });

  it('an @mention prompts someone not assigned; their own comments never prompt them', () => {
    const c = convo([
      { at: at('2026-11-02', '09:00'), userId: 'ann', kind: 'comment', mentions: ['bob'] },
      { at: at('2026-11-02', '09:30'), userId: 'bob', kind: 'comment', mentions: [] },
      { at: at('2026-11-02', '10:00'), userId: 'ann', kind: 'comment', mentions: [] },
    ]);
    const r = countResponses([c], NOV, ctx).get('p1')!;
    expect(r.get('bob')).toEqual([0.5]);
    // Bob's comment prompted Ann (the assignee); she answered half an hour later.
    expect(r.get('ann')).toEqual([0.5]);
  });

  it('answers outside the period are not counted; an unanswered prompt is not counted', () => {
    const c = convo([
      { at: at('2026-10-29', '09:00'), userId: 'bob', kind: 'comment', mentions: [] },
      { at: at('2026-10-29', '10:00'), userId: 'ann', kind: 'comment', mentions: [] },
      { at: at('2026-11-10', '09:00'), userId: 'bob', kind: 'comment', mentions: [] },
    ]);
    expect(countResponses([c], NOV, ctx).get('p1')?.get('ann') ?? []).toEqual([]);
  });
});
