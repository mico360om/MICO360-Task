import { describe, expect, it } from 'vitest';
import { buildHealthExtras, type ExtrasInput } from './health-extras';
import type { AttentionTask, HealthProjectRow, LinkRow } from './health-source';

const TZ = 'Asia/Muscat';
const ctx = { today: '2026-11-20', timeZone: TZ };
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const at = (key: string) => new Date(`${key}T06:00:00.000Z`);

const project = (over: Partial<HealthProjectRow> = {}): HealthProjectRow => ({
  id: 'p1',
  code: 'RIG',
  name: 'Rig',
  color: '#8B1E1E',
  icon: null,
  imageUrl: null,
  status: 'ACTIVE',
  archived: false,
  ownerId: 'owner',
  managerId: null,
  managerMemberIds: ['boss'],
  startDate: day('2026-11-01'),
  targetDate: day('2026-11-30'),
  updatedAt: at('2026-11-19'),
  completionMode: 'WEIGHT',
  weights: { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 },
  ...over,
});
let n = 0;
const task = (over: Partial<AttentionTask> = {}): AttentionTask => {
  n += 1;
  return {
    id: `t${n}`,
    key: `RIG-${n}`,
    title: `Task ${n}`,
    projectId: 'p1',
    columnId: 'c-todo',
    columnCategory: 'TODO',
    priority: 'NORMAL',
    startDate: null,
    dueDate: null,
    createdAt: at('2026-11-01'),
    updatedAt: at('2026-11-18'),
    version: 0,
    recurrenceRule: null,
    isMilestone: false,
    waiting: false,
    assignees: [{ id: 'sara', name: 'Sara' }],
    ...over,
  };
};
const link = (waiting: AttentionTask | { id: string; key: string; projectId?: string }, blocker: { id: string; key: string; projectId?: string; dueDate?: Date | null; open?: boolean }, waitingOpen = true): LinkRow => ({
  taskId: waiting.id,
  dependsOnTaskId: blocker.id,
  waiting: { id: waiting.id, key: waiting.key, projectId: waiting.projectId ?? 'p1', dueDate: null, open: waitingOpen },
  blocker: { id: blocker.id, key: blocker.key, projectId: blocker.projectId ?? 'p1', dueDate: blocker.dueDate ?? null, open: blocker.open ?? true },
});
const input = (over: Partial<ExtrasInput> = {}): ExtrasInput => ({
  project: project(),
  figures: { projectId: 'p1', total: 10, done: 7, weightTotal: 40, weightDone: 20, lastTaskUpdate: at('2026-11-19') },
  load: { projectId: 'p1', open: 3, people: [{ userId: 'sara', count: 3 }] },
  tasks: [],
  links: [],
  moves: new Map(),
  dueGroups: [],
  names: new Map([['sara', 'Sara Khan'], ['omar', 'Omar Ahmed'], ['boss', 'Bilal']]),
  ...over,
});

describe('a project’s health extras (1.23.5)', () => {
  it('completion in the project’s own mode, the count beside it; the time used', () => {
    const x = buildHealthExtras(input(), ctx);
    expect(x.completion).toMatchObject({ mode: 'WEIGHT', pct: 50, countPct: 70, weightPct: 50 });
    // 19 of 29 days gone.
    expect(x.timeUsedPct).toBe(66);
    expect(x.ragFacts.progress).toEqual({ donePct: 50, timeUsedPct: 66 });
  });

  it('no progress judgement without both dates, or without tasks', () => {
    expect(buildHealthExtras(input({ project: project({ startDate: null }) }), ctx).ragFacts.progress).toBeNull();
    expect(buildHealthExtras(input({ figures: { projectId: 'p1', total: 0, done: 0, weightTotal: 0, weightDone: 0, lastTaskUpdate: null } }), ctx).ragFacts.progress).toBeNull();
  });

  it('blocked over 7 days: a Blocked column since its move, and a real hold-up on a blocker of the same project — never a planned sequence or a blocker elsewhere', () => {
    const status = task({ columnCategory: 'BLOCKED' });
    const held = task({ dueDate: day('2026-12-10') });
    const planned = task({ dueDate: day('2026-12-10') });
    const elsewhere = task({ dueDate: day('2026-11-05') });
    const x = buildHealthExtras(
      input({
        tasks: [status, held, planned, elsewhere],
        moves: new Map([[status.id, at('2026-11-09')]]),
        links: [
          link(held, { id: 'b1', key: 'RIG-90', dueDate: day('2026-11-10') }),
          link(planned, { id: 'b2', key: 'RIG-91', dueDate: day('2026-12-01') }),
          link(elsewhere, { id: 'b3', key: 'OPS-1', projectId: 'p2', dueDate: day('2026-11-01') }),
        ],
      }),
      ctx,
    );
    expect(x.ragFacts.blockedLong).toBe(2);
    expect(x.risks.find((r) => r.code === 'BLOCKED')).toMatchObject({ taskIds: [status.id, held.id], accountable: ['sara'] });
    expect(x.holdUps.get(planned.id)).toBeUndefined();
    // The task with a late blocker elsewhere: late itself, never "blocked".
    expect(x.holdUps.get(elsewhere.id)).toBeUndefined();
  });

  it('a milestone at risk: its linked work is what it waits on, when it waits on anything', () => {
    const m = task({ isMilestone: true, title: 'Handover', dueDate: day('2026-11-23'), assignees: [{ id: 'omar', name: 'Omar' }] });
    const x = buildHealthExtras(
      input({
        tasks: [m],
        links: [link(m, { id: 'a', key: 'RIG-80', open: true }), link(m, { id: 'b', key: 'RIG-81', open: false })],
        // Plenty of finished work due before it: not looked at while it waits on tasks.
        dueGroups: [{ projectId: 'p1', dueDate: day('2026-11-10'), total: 20, open: 0 }],
      }),
      ctx,
    );
    expect(x.ragFacts.milestonesAtRisk).toEqual([{ title: 'Handover', daysLeft: 3, open: 1, total: 2 }]);
    expect(x.risks[0]).toMatchObject({ code: 'MILESTONE_AT_RISK', accountable: ['omar'] });
  });

  it('…otherwise the project’s other tasks due on or before its day (itself left out)', () => {
    const m = task({ isMilestone: true, title: 'Handover', dueDate: day('2026-11-23'), assignees: [] });
    const groups = [
      { projectId: 'p1', dueDate: day('2026-11-15'), total: 4, open: 1 },
      { projectId: 'p1', dueDate: day('2026-11-23'), total: 3, open: 3 },
      { projectId: 'p1', dueDate: day('2026-11-24'), total: 9, open: 9 },
    ];
    const x = buildHealthExtras(input({ tasks: [m], dueGroups: groups }), ctx);
    // 6 of 7 (4 + 3 − itself), 3 of them open (1 + 3 − itself): at risk; the project manager is accountable.
    expect(x.ragFacts.milestonesAtRisk).toEqual([{ title: 'Handover', daysLeft: 3, open: 3, total: 6 }]);
    expect(x.risks[0]).toMatchObject({ code: 'MILESTONE_AT_RISK', accountable: ['boss'] });
    const fine = buildHealthExtras(input({ tasks: [m], dueGroups: [{ ...groups[0]!, open: 0 }, groups[1]!] }), ctx);
    expect(fine.ragFacts.milestonesAtRisk).toEqual([]);
  });

  it('a late milestone is a red risk (the rule’s own late-milestone reason comes from the Management figures)', () => {
    const m = task({ isMilestone: true, title: 'Pour', dueDate: day('2026-11-17') });
    const x = buildHealthExtras(input({ tasks: [m] }), ctx);
    expect(x.risks[0]).toMatchObject({ code: 'MILESTONE_LATE', level: 'RED', title: 'Milestone “Pour” is 3 days late', accountable: ['sara'] });
  });

  it('a milestone waiting for approval is handed in: named among the owners, never late or at risk', () => {
    const m = task({ isMilestone: true, title: 'Pour', dueDate: day('2026-11-17'), waiting: true });
    const x = buildHealthExtras(input({ tasks: [m] }), ctx);
    expect(x.risks).toEqual([]);
    expect(x.milestones).toEqual([{ id: m.id, key: m.key, title: 'Pour', due: '2026-11-17', ownerIds: ['sara'] }]);
    expect(x.actions).toEqual([]);
  });

  it('workload names the person', () => {
    const x = buildHealthExtras(input({ load: { projectId: 'p1', open: 15, people: [{ userId: 'omar', count: 9 }, { userId: 'sara', count: 3 }, { userId: 'zara', count: 3 }] } }), ctx);
    expect(x.ragFacts.workload).toEqual({ name: 'Omar Ahmed', count: 9, openTotal: 15, pct: 60 });
    expect(x.risks[0]).toMatchObject({ code: 'WORKLOAD', title: 'Omar Ahmed holds 60% of the open work', accountable: ['boss'] });
  });

  it('overdue and unassigned work, and idle days, become risks', () => {
    const late = ['a', 'b', 'c'].map(() => task({ dueDate: day('2026-11-10') }));
    const free = task({ dueDate: day('2026-11-22'), assignees: [] });
    const x = buildHealthExtras(input({ tasks: [...late, free], project: project({ updatedAt: at('2026-11-01') }), figures: { projectId: 'p1', total: 4, done: 0, weightTotal: 8, weightDone: 0, lastTaskUpdate: at('2026-11-05') } }), ctx);
    expect(x.risks.map((r) => r.code)).toEqual(['OVERDUE', 'UNASSIGNED', 'NO_ACTIVITY']);
    expect(x.risks.find((r) => r.code === 'NO_ACTIVITY')).toMatchObject({ title: 'No activity for 15 days', accountable: ['owner'] });
    expect(x.managerId).toBe('boss');
  });

  it('next actions’ candidates: open tasks with their blockers of the project and how many wait on them', () => {
    const blocker = task({ dueDate: day('2026-11-10') });
    const waiter = task({ dueDate: day('2026-11-25') });
    const x = buildHealthExtras(input({ tasks: [blocker, waiter], links: [link(waiter, { id: blocker.id, key: blocker.key, dueDate: blocker.dueDate })] }), ctx);
    const w = x.actions.find((a) => a.id === waiter.id)!;
    expect(w).toMatchObject({ heldByBlockers: true, blockers: [{ id: blocker.id, key: blocker.key }], dependents: 0 });
    expect(x.actions.find((a) => a.id === blocker.id)).toMatchObject({ dependents: 1, heldByBlockers: false });
  });
});

describe('Notification & Scheduling centre: days late in the project’s company’s working days', () => {
  // Sunday to Thursday; Thursday 19 Nov 2026 a holiday. Today (ctx) is Friday 20 Nov.
  const calendar = { workingDays: [0, 1, 2, 3, 4], holidays: [{ day: '2026-11-19', name: 'Day off' }] };

  it('an overdue task and a late milestone count working days; the risks say so', () => {
    const late = task({ dueDate: day('2026-11-15'), isMilestone: true, title: 'Handover' });
    const calendarDays = buildHealthExtras(input({ tasks: [late] }), ctx);
    expect(calendarDays.risks.find((r) => r.code === 'MILESTONE_LATE')!.title).toBe('Milestone “Handover” is 5 days late');
    const working = buildHealthExtras(input({ tasks: [late] }), { ...ctx, calendar });
    // Mon 16, Tue 17, Wed 18 — Thursday is a holiday, Friday a weekend day.
    expect(working.risks.find((r) => r.code === 'MILESTONE_LATE')!.title).toBe('Milestone “Handover” is 3 working days late');
  });

  it('a task late only by days off is “late”, not “0 working days late”', () => {
    const late = task({ dueDate: day('2026-11-18'), isMilestone: true, title: 'Pour' });
    expect(buildHealthExtras(input({ tasks: [late] }), { ...ctx, calendar }).risks.find((r) => r.code === 'MILESTONE_LATE')!.title).toBe('Milestone “Pour” is late');
  });
});
