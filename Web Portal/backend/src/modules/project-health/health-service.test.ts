import { describe, expect, it } from 'vitest';
import { createProjectHealthService, HEALTH_TTL_MS, type Person } from './health-service';
import { buildHealthExtras, type ExtrasInput } from './health-extras';
import type { AttentionTask, HealthProjectRow } from './health-source';
import type { HealthRow } from '../management/management-service';
import type { HealthExtras } from './health-extras';

const TZ = 'Asia/Muscat';
// Friday 20 November 2026, 10:00 in Muscat.
const NOW = new Date('2026-11-20T06:00:00.000Z');
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
  startDate: null,
  targetDate: null,
  updatedAt: at('2026-11-19'),
  completionMode: 'COUNT',
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
    columnId: 'c1',
    columnCategory: 'TODO',
    priority: 'NORMAL',
    startDate: null,
    dueDate: null,
    createdAt: at('2026-11-01'),
    updatedAt: at('2026-11-18'),
    version: 3,
    recurrenceRule: null,
    isMilestone: false,
    waiting: false,
    assignees: [{ id: 'sara', name: 'Sara' }],
    ...over,
  };
};
const PEOPLE: Person[] = [
  { id: 'owner', name: 'Olivia Owner', avatarUrl: null },
  { id: 'boss', name: 'Bilal Boss', avatarUrl: '/b.png' },
  { id: 'sara', name: 'Sara Khan', avatarUrl: null },
];
const row = (id: string, over: Partial<HealthRow> = {}): HealthRow =>
  ({ id, rag: 'AMBER', reasons: [{ code: 'LATE_TASKS', level: 'AMBER', text: '1 late task' }], completionPct: 50, completionBy: 'COUNT', open: 7, late: 2, ...over }) as HealthRow;

function setup(projects: Record<string, Partial<ExtrasInput>>, checklistItems?: Parameters<typeof createProjectHealthService>[0]['checklistItems']) {
  let clock = NOW.getTime();
  const asked: string[][] = [];
  let hold: Promise<void> | null = null;
  const svc = createProjectHealthService({
    async health(ids) {
      asked.push([...ids]);
      if (hold) await hold;
      const extras = new Map<string, HealthExtras>();
      for (const id of ids) {
        const over = projects[id];
        if (!over) continue;
        extras.set(id, buildHealthExtras({ project: project({ id }), tasks: [], links: [], moves: new Map(), dueGroups: [], names: new Map(PEOPLE.map((p) => [p.id, p.name])), ...over }, { today: '2026-11-20', timeZone: TZ }));
      }
      return { rows: ids.filter((id) => projects[id]).map((id) => row(id)), extras };
    },
    people: async (ids) => PEOPLE.filter((p) => ids.includes(p.id)),
    doneColumns: async () => [{ id: 'done-off', enabled: false }, { id: 'done', enabled: true }],
    ...(checklistItems ? { checklistItems } : {}),
    timeZone: TZ,
    now: () => new Date(clock),
  });
  return { svc, asked, tick: (ms: number) => (clock += ms), holdWith: (p: Promise<void> | null) => (hold = p) };
}

describe('the Projects page cards', () => {
  it('each card: the mark and reasons, completion, the worst risk and who is accountable', async () => {
    const late = task({ isMilestone: true, title: 'Pour', dueDate: day('2026-11-18') });
    const { svc } = setup({ p1: { tasks: [late] }, p2: { project: project({ id: 'p2', managerMemberIds: [] }) } });
    const cards = await svc.cards(['p1', 'p2', 'gone']);
    expect(cards.get('p1')).toEqual({
      rag: 'AMBER',
      reasons: [{ code: 'LATE_TASKS', level: 'AMBER', text: '1 late task' }],
      completion: { mode: 'COUNT', pct: 0, countPct: 0, weightPct: 0 },
      topRisk: { code: 'MILESTONE_LATE', level: 'RED', title: 'Milestone “Pour” is 2 days late' },
      riskCount: 1,
      accountable: { id: 'boss', name: 'Bilal Boss', avatarUrl: '/b.png', role: 'MANAGER' },
    });
    // No named manager and no MANAGER member: the owner is accountable.
    expect(cards.get('p2')).toMatchObject({ topRisk: null, riskCount: 0, accountable: { id: 'owner', role: 'OWNER' } });
    expect(cards.has('gone')).toBe(false);
  });

  it('kept for 60 seconds per project; a change in one project reads only that one again', async () => {
    const { svc, asked, tick } = setup({ p1: {}, p2: {} });
    await svc.cards(['p1', 'p2']);
    await svc.cards(['p1', 'p2']);
    expect(asked).toEqual([['p1', 'p2']]);
    svc.changed('p2');
    await svc.cards(['p1', 'p2']);
    expect(asked.at(-1)).toEqual(['p2']);
    tick(HEALTH_TTL_MS + 1);
    await svc.cards(['p1']);
    expect(asked.at(-1)).toEqual(['p1']);
    svc.changed();
    await svc.cards(['p1', 'p2']);
    expect(asked.at(-1)).toEqual(['p1', 'p2']);
  });

  it('review I1: the answer read after a change is kept again (one read, then the cache)', async () => {
    const { svc, asked } = setup({ p1: {}, p2: {} });
    await svc.cards(['p1']);
    svc.changed('p1');
    await svc.cards(['p1']);
    await svc.cards(['p1']);
    expect(asked).toEqual([['p1'], ['p1']]);
    svc.changed();
    await svc.cards(['p1', 'p2']);
    await svc.cards(['p1', 'p2']);
    expect(asked).toEqual([['p1'], ['p1'], ['p1', 'p2']]);
  });

  it('an answer read while its project changed is used but not kept', async () => {
    const { svc, asked, holdWith } = setup({ p1: {} });
    let release!: () => void;
    holdWith(new Promise<void>((r) => (release = r)));
    const reading = svc.cards(['p1']);
    await Promise.resolve();
    svc.changed('p1');
    release();
    await reading;
    holdWith(null);
    await svc.cards(['p1']);
    expect(asked).toEqual([['p1'], ['p1']]);
  });
});

describe('the project page’s Overview', () => {
  it('every risk with its accountable people and tasks, and the accountable owners', async () => {
    const m = task({ isMilestone: true, title: 'Handover', dueDate: day('2026-11-30'), assignees: [{ id: 'sara', name: 'Sara Khan' }] });
    const late = ['a', 'b', 'c'].map(() => task({ dueDate: day('2026-11-10'), assignees: [] }));
    const { svc } = setup({ p1: { tasks: [m, ...late], project: project({ managerId: 'boss', managerMemberIds: ['boss', 'sara'] }) } });
    const d = (await svc.detail('p1'))!;
    expect(d.risks.map((r) => r.code)).toEqual(['OVERDUE', 'UNASSIGNED']);
    expect(d.risks[0]!.accountable.map((p) => p.name)).toEqual(['Bilal Boss']);
    expect(d.risks[0]!.tasks.map((t) => t.key)).toEqual(late.map((t) => t.key));
    expect(d.owners).toEqual({
      owner: { id: 'owner', name: 'Olivia Owner', avatarUrl: null },
      managers: [
        { id: 'boss', name: 'Bilal Boss', avatarUrl: '/b.png' },
        { id: 'sara', name: 'Sara Khan', avatarUrl: null },
      ],
      milestones: [{ id: m.id, key: m.key, title: 'Handover', due: '2026-11-30', owners: [{ id: 'sara', name: 'Sara Khan', avatarUrl: null }] }],
    });
    expect(await svc.detail('nope')).toBeNull();
  });

  it('board search lane (10 Nov): its open and overdue task counts, as the Management page counts them (the Kanban board’s project strip)', async () => {
    const { svc } = setup({ p1: {} });
    const d = (await svc.detail('p1'))!;
    // The row the one rule read: open = not done; overdue = open, not waiting for approval, due before today.
    expect(d.counts).toEqual({ open: 7, overdue: 2 });
  });
});

describe('Next actions', () => {
  it('Dashboard rows in the 1.23.4 order, Complete to the first enabled Done column', async () => {
    const soon = task({ dueDate: day('2026-11-24') });
    const late = task({ dueDate: day('2026-11-15') });
    const far = task({ dueDate: day('2026-12-24') });
    const { svc } = setup({ p1: { tasks: [soon, far, late] } });
    const a = (await svc.nextActions('p1'))!;
    expect(a.items.map((i) => [i.task!.key, i.reason.code])).toEqual([
      [late.key, 'overdue'],
      [soon.key, 'due-soon'],
    ]);
    expect(a).toMatchObject({ today: '2026-11-20', total: 2, watch: ['p1'], counts: { all: 2, overdue: 1, upcoming: 1 } });
    expect(a.items[0]).toMatchObject({ id: `task:${late.id}`, kind: 'task', task: { doneColumnId: 'done', version: 3, dueDate: '2026-11-15', project: { id: 'p1', code: 'RIG' }, can: { complete: true, reschedule: true, assign: true, approve: false } } });
  });

  it('nothing may be done on a completed or archived project (only Open)', async () => {
    const late = task({ dueDate: day('2026-11-15') });
    for (const p of [project({ status: 'COMPLETED' }), project({ archived: true })]) {
      const { svc } = setup({ p1: { tasks: [late], project: p } });
      expect((await svc.nextActions('p1'))!.items[0]!.task!.can).toEqual({ complete: false, reschedule: false, assign: false, approve: false });
    }
  });

  it('`fresh` reads the project again (after the person’s own change)', async () => {
    const { svc, asked } = setup({ p1: {} });
    await svc.nextActions('p1');
    await svc.nextActions('p1');
    await svc.nextActions('p1', { fresh: true });
    expect(asked).toEqual([['p1'], ['p1']]);
  });
});

describe('Next actions — 1.23.3 checklist items (design call 4)', () => {
  it('the person’s own assigned items of the project, ranked by their date with the tasks; nothing to tick on a completed project', async () => {
    const asked: unknown[] = [];
    const item = (status: 'ACTIVE' | 'COMPLETED') => setup(
      { p1: { tasks: [task({ dueDate: day('2026-11-18') })], project: project({ status }) } },
      {
        async collect(projectId, ctx, viewer) {
          asked.push([projectId, ctx.today, viewer]);
          return [{ kind: 'checklist-item', id: 'c1', key: null, priority: 'NORMAL', dueDate: day('2026-11-15'), createdAt: day('2026-11-15'), row: { checklistItem: { id: 'c1', text: 'Torque the bolts', dueDate: '2026-11-15', listTitle: 'Checklist', task: { id: 't9', key: 'RIG-9', title: 'Frame', projectId: 'p1' }, can: { tick: true, reschedule: true } } } }];
        },
      },
    );
    const { svc } = item('ACTIVE');
    const a = (await svc.nextActions('p1', { viewer: { id: 'sara', roles: ['EMPLOYEE'] } }))!;
    expect(asked).toEqual([['p1', '2026-11-20', { id: 'sara', roles: ['EMPLOYEE'] }]]);
    expect(a.items.map((i) => [i.id, i.reason])).toEqual([
      ['checklist-item:c1', { code: 'overdue', days: 5 }],
      [expect.stringMatching(/^task:/), { code: 'overdue', days: 2 }],
    ]);
    expect(a.items[0]!.checklistItem!.can).toEqual({ tick: true, reschedule: true });
    const done = (await item('COMPLETED').svc.nextActions('p1', { viewer: { id: 'sara', roles: [] } }))!;
    expect(done.items[0]!.checklistItem!.can).toEqual({ tick: false, reschedule: false });
  });
});
