import { describe, expect, it } from 'vitest';
import { approvalCycles, assignedAt, assignedDuring, baselineAsOf, doneMoment, isDoneNow, judgedPeople, type HistoryEvent, type KpiTask } from './task-history';

const TZ = 'Asia/Muscat';
const at = (day: string, hhmm = '10:00') => new Date(`${day}T${hhmm}:00+04:00`);
const ev = (day: string, action: string, userId: string, meta: unknown = {}, hhmm = '10:00'): HistoryEvent => ({ at: at(day, hhmm), action, userId, meta });
const due = (from: string | null, to: string | null) => ({ changes: [{ field: 'dueDate', from, to }] });

function task(over: Partial<KpiTask> = {}): KpiTask {
  return {
    id: 't1',
    key: 'P-1',
    title: 'Pour slab',
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
    assignees: [],
    events: [],
    ...over,
  };
}

// Rules: `mgr` runs the project, `boss` is an administrator, `ann` and `bob` are team members.
const RULES = { isAdmin: (id: string) => id === 'boss', runsProject: (id: string) => id === 'mgr' || id === 'boss' };
const dueAt = (day: string) => new Date(`${day}T12:00:00.000Z`);

describe('isDoneNow / doneMoment', () => {
  it('an open task is not done', () => {
    expect(isDoneNow(task())).toBe(false);
    expect(doneMoment(task())).toBeNull();
  });

  it('a completed task is done when it was completed', () => {
    const t = task({ columnCategory: 'DONE', completedAt: at('2026-10-05') });
    expect(isDoneNow(t)).toBe(true);
    expect(doneMoment(t)).toEqual(at('2026-10-05'));
  });

  it('a task waiting for approval counts as done when it was handed in (owner, 11 Nov)', () => {
    const t = task({ columnCategory: 'REVIEW', approvalRequestedAt: at('2026-10-04') });
    expect(isDoneNow(t)).toBe(false);
    expect(doneMoment(t)).toEqual(at('2026-10-04'));
  });

  it('an approved task counts from its hand-in, not the approval', () => {
    const t = task({
      columnCategory: 'DONE',
      completedAt: at('2026-10-09'),
      events: [ev('2026-10-04', 'APPROVAL_REQUESTED', 'ann'), ev('2026-10-09', 'APPROVED', 'mgr')],
    });
    expect(doneMoment(t)).toEqual(at('2026-10-04'));
  });

  it('handed in, sent back, handed in again, approved: the second hand-in', () => {
    const t = task({
      columnCategory: 'DONE',
      completedAt: at('2026-10-12'),
      events: [ev('2026-10-04', 'APPROVAL_REQUESTED', 'ann'), ev('2026-10-05', 'SENT_BACK', 'mgr'), ev('2026-10-08', 'APPROVAL_REQUESTED', 'ann'), ev('2026-10-12', 'APPROVED', 'mgr')],
    });
    expect(doneMoment(t)).toEqual(at('2026-10-08'));
  });

  it('a hand-in withdrawn before a plain completion does not count', () => {
    const t = task({
      columnCategory: 'DONE',
      completedAt: at('2026-10-12'),
      events: [ev('2026-10-04', 'APPROVAL_REQUESTED', 'ann'), ev('2026-10-05', 'APPROVAL_WITHDRAWN', 'ann'), ev('2026-10-12', 'COMPLETED', 'mgr')],
    });
    expect(doneMoment(t)).toEqual(at('2026-10-12'));
  });

  it('a task in a Done column without a completion time: its last move into Done, else its last change', () => {
    expect(doneMoment(task({ columnCategory: 'DONE', events: [ev('2026-10-03', 'MOVED', 'ann'), ev('2026-10-06', 'COMPLETED', 'ann')] }))).toEqual(at('2026-10-06'));
    expect(doneMoment(task({ columnCategory: 'DONE', updatedAt: at('2026-10-07') }))).toEqual(at('2026-10-07'));
  });
});

describe('assignment history', () => {
  it('current assignees with no history are on it from when they were assigned', () => {
    const t = task({ assignees: [{ userId: 'ann', assignedAt: at('2026-10-02') }] });
    expect(assignedAt(t, at('2026-10-01', '12:00'))).toEqual([]);
    expect(assignedAt(t, at('2026-10-03'))).toEqual(['ann']);
  });

  it('a reassignment: who was on it before and after', () => {
    const t = task({
      assignees: [{ userId: 'bob', assignedAt: at('2026-10-05') }],
      events: [ev('2026-10-01', 'ASSIGNED', 'mgr', { assigneeId: 'ann' }, '08:00'), ev('2026-10-05', 'UNASSIGNED', 'mgr', { assigneeId: 'ann' }), ev('2026-10-05', 'ASSIGNED', 'mgr', { assigneeId: 'bob' })],
    });
    expect(assignedAt(t, at('2026-10-03'))).toEqual(['ann']);
    expect(assignedAt(t, at('2026-10-06'))).toEqual(['bob']);
    expect(assignedDuring(t, at('2026-10-05', '08:00'), at('2026-10-05', '23:00')).sort()).toEqual(['ann', 'bob']);
  });

  it('someone taken off with no recorded assignment was on it from its creation', () => {
    const t = task({ events: [ev('2026-10-04', 'UNASSIGNED', 'mgr', { assigneeId: 'ann' })] });
    expect(assignedAt(t, at('2026-10-02'))).toEqual(['ann']);
    expect(assignedAt(t, at('2026-10-05'))).toEqual([]);
  });
});

describe('baselineAsOf — the agreed due date (owner, 11 Nov)', () => {
  const assigned = { assignees: [{ userId: 'ann', assignedAt: at('2026-10-01', '09:00') }] };

  it('no recorded change: the due date itself', () => {
    expect(baselineAsOf(task({ ...assigned, dueDate: dueAt('2026-10-10') }), at('2026-10-20'), RULES, TZ)).toBe('2026-10-10');
  });

  it('no due date at all: null', () => {
    expect(baselineAsOf(task(assigned), at('2026-10-20'), RULES, TZ)).toBeNull();
  });

  it('the assignee moving it later does not move the baseline', () => {
    const t = task({ ...assigned, dueDate: dueAt('2026-10-15'), events: [ev('2026-10-08', 'UPDATED', 'ann', due('2026-10-10', '2026-10-15'))] });
    expect(baselineAsOf(t, at('2026-10-20'), RULES, TZ)).toBe('2026-10-10');
  });

  it('a colleague (not running the project) moving it does not move it either', () => {
    const t = task({ ...assigned, dueDate: dueAt('2026-10-15'), events: [ev('2026-10-08', 'UPDATED', 'bob', due('2026-10-10', '2026-10-15'))] });
    expect(baselineAsOf(t, at('2026-10-20'), RULES, TZ)).toBe('2026-10-10');
  });

  it('the project manager moving it re-baselines (an agreed extension)', () => {
    const t = task({ ...assigned, dueDate: dueAt('2026-10-15'), events: [ev('2026-10-08', 'UPDATED', 'mgr', due('2026-10-10', '2026-10-15'))] });
    expect(baselineAsOf(t, at('2026-10-20'), RULES, TZ)).toBe('2026-10-15');
  });

  it('a project manager moving their OWN task does not re-baseline; an administrator always does', () => {
    const own = { assignees: [{ userId: 'mgr', assignedAt: at('2026-10-01', '09:00') }] };
    expect(baselineAsOf(task({ ...own, dueDate: dueAt('2026-10-15'), events: [ev('2026-10-08', 'UPDATED', 'mgr', due('2026-10-10', '2026-10-15'))] }), at('2026-10-20'), RULES, TZ)).toBe('2026-10-10');
    const admin = { assignees: [{ userId: 'boss', assignedAt: at('2026-10-01', '09:00') }] };
    expect(baselineAsOf(task({ ...admin, dueDate: dueAt('2026-10-15'), events: [ev('2026-10-08', 'UPDATED', 'boss', due('2026-10-10', '2026-10-15'))] }), at('2026-10-20'), RULES, TZ)).toBe('2026-10-15');
  });

  it('changes before anyone was assigned are planning: they set the baseline whoever made them', () => {
    const t = task({
      assignees: [{ userId: 'ann', assignedAt: at('2026-10-03') }],
      dueDate: dueAt('2026-10-12'),
      events: [ev('2026-10-02', 'UPDATED', 'bob', due('2026-10-10', '2026-10-12')), ev('2026-10-03', 'ASSIGNED', 'mgr', { assigneeId: 'ann' })],
    });
    expect(baselineAsOf(t, at('2026-10-20'), RULES, TZ)).toBe('2026-10-12');
  });

  it('the assignee clearing the due date cannot escape it; the manager clearing it removes it', () => {
    const cleared = (by: string) => task({ ...assigned, dueDate: null, events: [ev('2026-10-08', 'UPDATED', by, due('2026-10-10', null))] });
    expect(baselineAsOf(cleared('ann'), at('2026-10-20'), RULES, TZ)).toBe('2026-10-10');
    expect(baselineAsOf(cleared('mgr'), at('2026-10-20'), RULES, TZ)).toBeNull();
  });

  it('a first due date (none agreed before) is the first commitment, whoever sets it', () => {
    const t = task({ ...assigned, dueDate: dueAt('2026-10-09'), events: [ev('2026-10-05', 'UPDATED', 'ann', due(null, '2026-10-09'))] });
    expect(baselineAsOf(t, at('2026-10-20'), RULES, TZ)).toBe('2026-10-09');
  });

  it('only changes made by the moment asked about count', () => {
    const t = task({ ...assigned, dueDate: dueAt('2026-10-15'), events: [ev('2026-10-08', 'UPDATED', 'mgr', due('2026-10-10', '2026-10-15'))] });
    expect(baselineAsOf(t, at('2026-10-07'), RULES, TZ)).toBe('2026-10-10');
  });

  it('a task with no due date yet at that moment has no baseline then', () => {
    const t = task({ ...assigned, dueDate: dueAt('2026-10-09'), events: [ev('2026-10-05', 'UPDATED', 'mgr', due(null, '2026-10-09'))] });
    expect(baselineAsOf(t, at('2026-10-04'), RULES, TZ)).toBeNull();
  });
});

describe('judgedPeople — on time / late counts for everyone assigned on its due day (call 2)', () => {
  it('a late task handed to someone else after its due day still counts against who had it on the day', () => {
    const t = task({
      assignees: [{ userId: 'bob', assignedAt: at('2026-10-12') }],
      events: [ev('2026-10-01', 'ASSIGNED', 'mgr', { assigneeId: 'ann' }, '08:00'), ev('2026-10-12', 'UNASSIGNED', 'mgr', { assigneeId: 'ann' }), ev('2026-10-12', 'ASSIGNED', 'mgr', { assigneeId: 'bob' })],
    });
    expect(judgedPeople(t, '2026-10-10', at('2026-10-14'), TZ)).toEqual(['ann']);
  });

  it('finished before its due day: whoever was on it when it was finished', () => {
    const t = task({ assignees: [{ userId: 'ann', assignedAt: at('2026-10-01', '09:00') }] });
    expect(judgedPeople(t, '2026-10-10', at('2026-10-05'), TZ)).toEqual(['ann']);
  });

  it('several assignees each count', () => {
    const t = task({ assignees: [{ userId: 'ann', assignedAt: at('2026-10-01', '09:00') }, { userId: 'bob', assignedAt: at('2026-10-01', '09:00') }] });
    expect(judgedPeople(t, '2026-10-10', at('2026-10-11'), TZ).sort()).toEqual(['ann', 'bob']);
  });
});

describe('approvalCycles', () => {
  it('a hand-in and its decision, with who decided', () => {
    const t = task({ events: [ev('2026-10-04', 'APPROVAL_REQUESTED', 'ann'), ev('2026-10-05', 'APPROVED', 'mgr')] });
    expect(approvalCycles(t)).toEqual([{ requestedAt: at('2026-10-04'), decidedAt: at('2026-10-05'), decidedBy: 'mgr', outcome: 'APPROVED' }]);
  });

  it('sent back then approved: two decisions; withdrawn: none; still waiting: none', () => {
    const t = task({
      events: [
        ev('2026-10-04', 'APPROVAL_REQUESTED', 'ann'),
        ev('2026-10-05', 'SENT_BACK', 'mgr'),
        ev('2026-10-06', 'APPROVAL_REQUESTED', 'ann'),
        ev('2026-10-07', 'APPROVAL_WITHDRAWN', 'ann'),
        ev('2026-10-08', 'APPROVAL_REQUESTED', 'ann'),
        ev('2026-10-09', 'COMPLETED', 'mgr', { approved: true }),
        ev('2026-10-10', 'REOPENED', 'mgr'),
        ev('2026-10-11', 'APPROVAL_REQUESTED', 'ann'),
      ],
    });
    expect(approvalCycles(t).map((c) => [c.outcome, c.decidedBy])).toEqual([
      ['SENT_BACK', 'mgr'],
      ['APPROVED', 'mgr'],
    ]);
  });
});
