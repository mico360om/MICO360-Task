import { describe, expect, it } from 'vitest';
import { createKpiEngine } from './kpi-engine';
import { createMemoryKpiSource, projectRow } from './kpi-source.fixture';
import { createMemorySnapshotStore } from './kpi-stores';
import { createSnapshotJob, sumSlices, type SnapshotState } from './kpi-snapshots';
import { windowOf } from './kpi-calc';
import type { KpiTask } from './task-history';

const TZ = 'Asia/Muscat';
const at = (day: string, hhmm = '10:00') => new Date(`${day}T${hhmm}:00+04:00`);
const dueAt = (day: string) => new Date(`${day}T12:00:00.000Z`);
let n = 0;
function task(over: Partial<KpiTask> = {}): KpiTask {
  n += 1;
  return {
    id: `t${n}`,
    key: `P-${n}`,
    title: `Task ${n}`,
    projectId: 'p1',
    createdAt: at('2026-04-01', '08:00'),
    updatedAt: at('2026-04-01', '08:00'),
    startDate: null,
    dueDate: null,
    completedAt: null,
    columnCategory: 'TODO',
    approvalRequestedAt: null,
    priority: 'NORMAL',
    weight: null,
    assignees: [{ userId: 'ann', assignedAt: at('2026-04-01', '08:00') }],
    events: [],
    ...over,
  };
}
const done = (day: string, due?: string) => task({ columnCategory: 'DONE', completedAt: at(day), dueDate: due ? dueAt(due) : null });

function setup(nowDay: string, tasks: KpiTask[]) {
  let now = at(nowDay, '02:00');
  const world = { projects: [projectRow('p1')], tasks };
  const source = createMemoryKpiSource(world);
  const engine = createKpiEngine({ source, timeZone: TZ, rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4], holidays: [] }, hours: { start: '08:00', end: '17:00' } }), now: () => now });
  const store = createMemorySnapshotStore();
  let state: SnapshotState = { launchDay: null, rebuiltAt: null, lastNightlyDay: null };
  const job = createSnapshotJob({
    engine,
    source,
    store,
    state: { get: async () => state, set: async (s) => void (state = s) },
    projectIds: async () => ['p1'],
    weekStart: async () => 0,
    timeZone: TZ,
    now: () => now,
  });
  return { job, store, engine, source, world, state: () => state, setNow: (d: string, hhmm = '02:00') => void (now = at(d, hhmm)) };
}

describe('KPI snapshots', () => {
  it('at launch: the past six closed months are rebuilt from task dates and history, marked rebuilt', async () => {
    const s = setup('2026-11-11', [done('2026-06-10', '2026-06-12'), done('2026-10-20', '2026-10-15'), done('2026-11-03', '2026-11-04')]);
    const r = await s.job.run();
    expect(r.did).toBe('rebuild');
    const months = [...new Set(s.store.all.map((x) => x.month))].sort();
    expect(months).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(s.store.all.every((x) => x.rebuilt)).toBe(true);
    expect(s.state()).toMatchObject({ launchDay: '2026-11-11', lastNightlyDay: '2026-11-11' });
    expect(s.state().rebuiltAt).toBeTruthy();
    // The current month is never stored (it is live).
    expect(s.store.all.some((x) => x.month === '2026-11')).toBe(false);
  });

  it('a month’s slices add up to the month counted in one go', async () => {
    const tasks = [done('2026-10-01', '2026-10-02'), done('2026-10-08', '2026-10-05'), done('2026-10-29', '2026-10-30'), task({ dueDate: dueAt('2026-10-20') })];
    const s = setup('2026-11-11', tasks);
    await s.job.run();
    const oct = sumSlices(s.store.all.filter((x) => x.month === '2026-10' && x.userId === ''));
    const facts = await s.engine.load([projectRow('p1')], at('2026-10-01', '00:00'), at('2026-11-01', '00:00'));
    const whole = s.engine.counts(facts, windowOf('2026-10-01', '2026-10-31', TZ, at('2026-11-11'))).projects.get('p1')!;
    expect(oct.counters).toMatchObject({ completed: whole.completed, dueDone: whole.dueDone, onTime: whole.onTime, lateCount: whole.lateCount, lateDays: whole.lateDays, openDue: whole.openDue, overdue: whole.overdue });
    expect(oct.counters.completed).toBe(3);
    expect(oct.rebuilt).toBe(true);
  });

  it('people rows: only people with something counted', async () => {
    const s = setup('2026-11-11', [done('2026-10-01', '2026-10-02')]);
    await s.job.run();
    const people = s.store.all.filter((x) => x.userId !== '');
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((x) => x.userId === 'ann')).toBe(true);
  });

  it('nightly: the last two closed months are worked out again; older months stay frozen; once a day', async () => {
    const t = done('2026-08-10', '2026-08-12');
    const s = setup('2026-11-11', [t, done('2026-10-05', '2026-10-06')]);
    await s.job.run();
    const augBefore = sumSlices(s.store.all.filter((x) => x.month === '2026-08' && x.userId === '')).counters.completed;
    // Old and recent work change afterwards (a task binned, one restored, edited…).
    s.world.tasks.push(done('2026-10-20', '2026-10-21'));
    s.world.tasks.splice(s.world.tasks.indexOf(t), 1);
    s.setNow('2026-11-12');
    expect((await s.job.run()).did).toBe('nightly');
    expect(sumSlices(s.store.all.filter((x) => x.month === '2026-10' && x.userId === '')).counters.completed).toBe(2);
    expect(sumSlices(s.store.all.filter((x) => x.month === '2026-08' && x.userId === '')).counters.completed).toBe(augBefore);
    // Recomputed after launch, but the slices are from before it: still "rebuilt".
    expect(s.store.all.filter((x) => x.month === '2026-10').every((x) => x.rebuilt)).toBe(true);
    expect((await s.job.run()).did).toBe('nothing');
  });

  it('nightly waits for 01:00 company time', async () => {
    const s = setup('2026-11-11', []);
    await s.job.run();
    s.setNow('2026-11-12', '00:30');
    expect((await s.job.run()).did).toBe('nothing');
    s.setNow('2026-11-12', '01:05');
    expect((await s.job.run()).did).toBe('nightly');
  });

  it('slices after launch are not marked rebuilt', async () => {
    const s = setup('2026-09-15', [done('2026-09-20', '2026-09-21')]);
    await s.job.run();
    s.setNow('2026-11-02');
    await s.job.run();
    const sep = s.store.all.filter((x) => x.month === '2026-09' && x.userId === '');
    expect(sep.filter((x) => x.day >= '2026-09-15').every((x) => !x.rebuilt)).toBe(true);
    expect(sep.filter((x) => x.day < '2026-09-15').every((x) => x.rebuilt)).toBe(true);
  });
});
