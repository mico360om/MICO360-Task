import { describe, expect, it } from 'vitest';
import { BUILT_IN_SCHEDULES, DEFAULT_POLICY, type NotificationPolicy } from './policy';
import { bundleNotices, planReminders, type PlannerCompanyRules, type PlannerInput, type PlannerTask } from './planner';

const TZ = 'Asia/Muscat';
// Sun–Thu working week; Wed 18 Nov 2026 a holiday. Noon Muscat on a day = 08:00Z.
const at = (day: string) => new Date(`${day}T08:00:00Z`);
const day = (d: string) => new Date(`${d}T00:00:00Z`); // a stored due date (UTC midnight = that calendar day)

const rules = (over: Partial<PlannerCompanyRules> = {}, policy: Partial<NotificationPolicy> = {}): PlannerCompanyRules => ({
  policy: { ...DEFAULT_POLICY, ...policy },
  calendar: { workingDays: [0, 1, 2, 3, 4], holidays: [{ day: '2026-11-18', name: 'National Day' }] },
  schedules: new Map([
    ['std', BUILT_IN_SCHEDULES.STANDARD.steps],
    ['crit', BUILT_IN_SCHEDULES.CRITICAL.steps],
  ]),
  defaultScheduleId: 'std',
  ...over,
});

const task = (t: Partial<PlannerTask> = {}): PlannerTask => ({
  id: 't1',
  key: 'MICO-1',
  title: 'Pour slab',
  companyId: 'c1',
  dueDate: day('2026-11-12'), // a Thursday
  startDate: day('2026-11-01'),
  columnCategory: 'TODO',
  completedAt: null,
  approvalRequestedAt: null,
  scheduleId: null,
  projectScheduleId: null,
  escalation: null,
  remindIds: ['a1'],
  assigneeIds: ['a1'],
  runnerIds: ['pm'],
  approverIds: ['pm'],
  step2Ids: ['admin'],
  enteredColumnAt: null,
  lastActivityAt: null,
  hasOpenBlocker: false,
  ...t,
});

const plan = (tasks: PlannerTask[], now: string, over: Partial<PlannerInput> = {}) => {
  const r = over.rules ?? (() => rules());
  return planReminders({ now: at(now), timeZone: TZ, tasks, rules: r, ...over });
};
const brief = (ns: ReturnType<typeof plan>) => ns.map((n) => `${n.userId} ${n.type} ${n.dedupeKey}`);

describe('due-soon and overdue reminders follow the schedule, in working days', () => {
  it('Standard: 2 working days before, on the due morning, 1 working day after, then every 2', () => {
    // Due Thu 12 Nov. Two working days before: Tue 10 Nov.
    expect(brief(plan([task()], '2026-11-09'))).toEqual([]);
    expect(brief(plan([task()], '2026-11-10'))).toEqual(['a1 TASK_DUE_SOON rem:t1:2026-11-12:-2:a1']);
    expect(brief(plan([task()], '2026-11-11'))).toEqual(['a1 TASK_DUE_SOON rem:t1:2026-11-12:-2:a1']); // same step: the log stops it
    expect(plan([task()], '2026-11-12')[0]).toMatchObject({ type: 'TASK_DUE_SOON', title: 'A task is due today', dedupeKey: 'rem:t1:2026-11-12:0:a1' });
    // Fri + Sat are off: nothing new (not yet a working day late).
    expect(brief(plan([task()], '2026-11-14'))).toEqual([]);
    expect(plan([task()], '2026-11-15')[0]).toMatchObject({ type: 'TASK_OVERDUE', title: 'A task is 1 working day overdue', dedupeKey: 'rem:t1:2026-11-12:1:a1' });
    expect(plan([task()], '2026-11-16')[0]!.dedupeKey).toBe('rem:t1:2026-11-12:1:a1');
    // Wed 18 is a holiday: Tue 17 = 3, Thu 19 = 4 → still step 3; Sun 22 = 5.
    expect(plan([task()], '2026-11-17')[0]!.dedupeKey).toBe('rem:t1:2026-11-12:3:a1');
    expect(plan([task()], '2026-11-19')[0]!.dedupeKey).toBe('rem:t1:2026-11-12:3:a1');
    expect(plan([task()], '2026-11-22')[0]).toMatchObject({ dedupeKey: 'rem:t1:2026-11-12:5:a1', title: 'A task is 5 working days overdue' });
  });

  it('the body names the task the usual way, and the notice opens it', () => {
    expect(plan([task()], '2026-11-10')[0]).toMatchObject({ body: 'MICO-1 · Pour slab', entityType: 'task', entityId: 't1', kind: 'dueSoon' });
  });

  it('a task’s own schedule wins over its project’s, which wins over the company default', () => {
    expect(plan([task({ projectScheduleId: 'crit' })], '2026-11-05')[0]!.dedupeKey).toBe('rem:t1:2026-11-12:-5:a1');
    expect(plan([task({ projectScheduleId: 'crit', scheduleId: 'std' })], '2026-11-05')).toEqual([]);
    // A schedule of another company (the project moved) is ignored.
    expect(plan([task({ scheduleId: 'elsewhere' })], '2026-11-10')[0]!.dedupeKey).toBe('rem:t1:2026-11-12:-2:a1');
  });

  it('a person’s own lead time adds one more “due soon” step for them (calendar days, as before)', () => {
    const ns = plan([task({ remindIds: ['a1', 'a2'] })], '2026-11-05', { leadDaysFor: (u) => (u === 'a2' ? 7 : undefined) });
    expect(brief(ns)).toEqual(['a2 TASK_DUE_SOON rem:t1:2026-11-12:L7:a2']);
  });

  it('done tasks, tasks waiting for approval and tasks without a due date get none', () => {
    expect(plan([task({ columnCategory: 'DONE' }), task({ id: 't2', completedAt: at('2026-11-11') }), task({ id: 't3', dueDate: null })], '2026-11-15')).toEqual([]);
    expect(plan([task({ approvalRequestedAt: at('2026-11-15') })], '2026-11-15').filter((n) => n.kind === 'overdue' || n.kind === 'dueSoon')).toEqual([]);
  });

  it('an admin can turn a reminder kind off for the company', () => {
    const off = () => rules({}, { remindersOn: { ...DEFAULT_POLICY.remindersOn, overdue: false } });
    expect(plan([task()], '2026-11-15', { rules: off })).toEqual([]);
    expect(plan([task()], '2026-11-10', { rules: off })).toHaveLength(1);
  });

  it('checklist items with a due date follow their task’s schedule', () => {
    const ns = planReminders({
      now: at('2026-11-15'),
      timeZone: TZ,
      tasks: [],
      items: [{ id: 'i1', text: 'Label circuits', dueDate: day('2026-11-12'), taskId: 't1', taskKey: 'MICO-1', companyId: 'c1', scheduleId: null, projectScheduleId: null, recipientIds: ['a1'] }],
      rules: () => rules(),
    });
    expect(ns).toEqual([expect.objectContaining({ userId: 'a1', type: 'TASK_OVERDUE', title: 'A checklist item is 1 working day overdue', body: 'MICO-1 · Label circuits', dedupeKey: 'rem:item:i1:2026-11-12:1:a1', entityId: 't1' })]);
  });
});

describe('escalations: two steps in working days', () => {
  const esc = (ns: ReturnType<typeof plan>) => brief(ns.filter((n) => n.kind === 'escalation' || n.kind === 'escalationAdmin'));

  it('step 1 to whoever runs the project after 3 working days, then weekly (every working week)', () => {
    expect(esc(plan([task()], '2026-11-16'))).toEqual([]); // 2 working days late
    expect(esc(plan([task()], '2026-11-17'))).toEqual(['pm TASK_ESCALATION esc1:t1:2026-11-12:0']); // 3
    expect(plan([task()], '2026-11-17').find((n) => n.kind === 'escalation')!.title).toBe('Escalation: MICO-1 is 3 working days overdue');
    expect(esc(plan([task()], '2026-11-23'))).toEqual(['pm TASK_ESCALATION esc1:t1:2026-11-12:0']); // 6 (holiday on the 18th)
    // 3 + 5 working days = 8 late: step 1 again (the week after), and step 2 to the admins, once.
    expect(esc(plan([task()], '2026-11-25'))).toEqual(['pm TASK_ESCALATION esc1:t1:2026-11-12:1', 'admin TASK_ESCALATION_ADMIN esc2:t1:2026-11-12']);
  });

  it('a project can override the numbers', () => {
    expect(esc(plan([task({ escalation: { step1Days: 1, step2Days: 1 } })], '2026-11-16'))).toEqual(['pm TASK_ESCALATION esc1:t1:2026-11-12:0', 'admin TASK_ESCALATION_ADMIN esc2:t1:2026-11-12']);
  });

  it('a Blocked task: one notice when blocked, then weekly; its overdue step 1 is the blocked one', () => {
    const blocked = task({ columnCategory: 'BLOCKED', enteredColumnAt: at('2026-11-15'), dueDate: day('2026-12-31') });
    expect(esc(plan([blocked], '2026-11-15'))).toEqual(['pm TASK_ESCALATION blk:t1:2026-11-15:0']);
    expect(plan([blocked], '2026-11-15').find((n) => n.kind === 'escalation')!.title).toBe('Escalation: MICO-1 is Blocked');
    expect(esc(plan([blocked], '2026-11-19'))).toEqual(['pm TASK_ESCALATION blk:t1:2026-11-15:0']);
    expect(esc(plan([blocked], '2026-11-23'))).toEqual(['pm TASK_ESCALATION blk:t1:2026-11-15:1']);
    expect(esc(plan([task({ columnCategory: 'BLOCKED', enteredColumnAt: at('2026-11-15') })], '2026-11-17'))).toEqual(['pm TASK_ESCALATION blk:t1:2026-11-15:0']);
  });

  it('step 2 goes to whoever the company chose (already filtered to people who may open the task)', () => {
    expect(esc(plan([task({ step2Ids: ['boss', 'admin'] })], '2026-11-25')).slice(1)).toEqual(['boss TASK_ESCALATION_ADMIN esc2:t1:2026-11-12', 'admin TASK_ESCALATION_ADMIN esc2:t1:2026-11-12']);
  });

  it('turned off, there are none', () => {
    const off = () => rules({}, { remindersOn: { ...DEFAULT_POLICY.remindersOn, escalation: false, escalationAdmin: false } });
    expect(esc(plan([task()], '2026-11-25', { rules: off }))).toEqual([]);
  });
});

describe('approvals waiting too long', () => {
  const waiting = task({ approvalRequestedAt: new Date('2026-11-12T06:00:00Z'), columnCategory: 'REVIEW' });
  const apr = (ns: ReturnType<typeof plan>) => brief(ns.filter((n) => n.kind === 'approvalWaiting' || n.kind === 'escalationAdmin'));

  it('step 1 reminds the approver after 2 working days; step 2 goes to the admins after 5 more', () => {
    expect(apr(plan([waiting], '2026-11-15'))).toEqual([]);
    expect(apr(plan([waiting], '2026-11-16'))).toEqual(['pm TASK_APPROVAL_WAITING apw1:t1:2026-11-12']);
    expect(plan([waiting], '2026-11-16').find((n) => n.kind === 'approvalWaiting')!.title).toBe('MICO-1 has waited 2 working days for your approval');
    expect(apr(plan([waiting], '2026-11-24'))).toEqual(['pm TASK_APPROVAL_WAITING apw1:t1:2026-11-12', 'admin TASK_ESCALATION_ADMIN apw2:t1:2026-11-12']);
  });

  it('a task waiting for approval has no overdue escalation', () => {
    expect(plan([waiting], '2026-11-24').filter((n) => n.dedupeKey.startsWith('esc'))).toEqual([]);
  });
});

describe('inactivity', () => {
  const started = (t: Partial<PlannerTask> = {}) => task({ columnCategory: 'IN_PROGRESS', dueDate: day('2026-12-31'), lastActivityAt: new Date('2026-11-08T06:00:00Z'), ...t });
  const idle = (ns: ReturnType<typeof plan>) => brief(ns.filter((n) => n.kind === 'inactivity'));

  it('5 working days without activity reminds the assignees; 10 the project manager too', () => {
    expect(idle(plan([started()], '2026-11-12'))).toEqual([]); // 4
    expect(idle(plan([started()], '2026-11-15'))).toEqual(['a1 TASK_INACTIVE idle1:t1:2026-11-08']); // 5
    expect(plan([started()], '2026-11-15').find((n) => n.kind === 'inactivity')!.title).toBe('No activity on MICO-1 for 5 working days');
    // 10 working days (the 18th is a holiday): Mon 23 Nov — only the step reached (never two at once).
    expect(idle(plan([started()], '2026-11-23'))).toEqual(['a1 TASK_INACTIVE idle2:t1:2026-11-08', 'pm TASK_INACTIVE idle2:t1:2026-11-08']);
  });

  it('new activity starts the count again (a new key)', () => {
    expect(idle(plan([started({ lastActivityAt: new Date('2026-11-15T06:00:00Z') })], '2026-11-23'))).toEqual(['a1 TASK_INACTIVE idle1:t1:2026-11-15']);
  });

  it('skipped: not started (To do), waiting for its start day, Blocked, an open blocker, done, waiting for approval', () => {
    const now = '2026-11-23';
    expect(idle(plan([started({ columnCategory: 'TODO' })], now))).toEqual([]);
    expect(idle(plan([started({ startDate: day('2026-11-30') })], now))).toEqual([]);
    expect(idle(plan([started({ columnCategory: 'BLOCKED' })], now))).toEqual([]);
    expect(idle(plan([started({ hasOpenBlocker: true })], now))).toEqual([]);
    expect(idle(plan([started({ completedAt: at('2026-11-10') })], now))).toEqual([]);
    expect(idle(plan([started({ approvalRequestedAt: at('2026-11-10') })], now))).toEqual([]);
    // Review counts as started.
    expect(idle(plan([started({ columnCategory: 'REVIEW' })], '2026-11-15'))).toEqual(['a1 TASK_INACTIVE idle1:t1:2026-11-08']);
  });

  it('the company’s numbers apply', () => {
    const r = () => rules({}, { inactivity: { assigneeDays: 2, managerDays: 3 } });
    expect(idle(plan([started()], '2026-11-10', { rules: r }))).toEqual(['a1 TASK_INACTIVE idle1:t1:2026-11-08']);
    expect(idle(plan([started()], '2026-11-11', { rules: r }))).toEqual(['a1 TASK_INACTIVE idle2:t1:2026-11-08', 'pm TASK_INACTIVE idle2:t1:2026-11-08']);
  });
});

describe('never a burst', () => {
  it('plans are the same on every run (stable keys: the log sends each once)', () => {
    const tasks = [task(), task({ id: 't2', key: 'MICO-2' })];
    expect(plan(tasks, '2026-11-17').map((n) => n.dedupeKey)).toEqual(plan(tasks, '2026-11-17').map((n) => n.dedupeKey));
  });

  it('more than three of one kind for one person in a run become one notice listing them', () => {
    const many = [1, 2, 3, 4, 5].map((i) => task({ id: `t${i}`, key: `MICO-${i}`, title: `Task ${i}` }));
    const out = bundleNotices(plan(many, '2026-11-15'));
    const overdue = out.filter((b) => b.userId === 'a1' && b.kind === 'overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.notice).toMatchObject({ type: 'TASK_OVERDUE', title: '5 tasks are overdue', entityType: 'my-tasks', entityId: null });
    expect(overdue[0]!.notice.body).toBe('MICO-1 · Task 1\nMICO-2 · Task 2\nMICO-3 · Task 3\nMICO-4 · Task 4\nMICO-5 · Task 5');
    expect(overdue[0]!.dedupeKeys).toHaveLength(5);
    // Three or fewer stay one notice each.
    expect(bundleNotices(plan(many.slice(0, 3), '2026-11-15')).filter((b) => b.kind === 'overdue')).toHaveLength(3);
  });
});
