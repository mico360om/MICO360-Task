import { describe, expect, it } from 'vitest';
import { DEFAULT_MANAGEMENT_FILTERS } from './kpi-service';
import { at, done, dueAt, setup, task, v } from './kpi-service.fixture';


describe('user KPIs — who may see whose (owner 2)', () => {
  const world = { tasks: [done('2026-11-03', '2026-11-04'), done('2026-11-04', '2026-11-02', { projectId: 'p2' })] };

  it('the person sees their own, across every project they can see', async () => {
    const { service } = setup(world);
    const k = await service.personKpis(v('ann'), 'ann', { kind: 'month' });
    expect(k.scope).toBe('self');
    expect(k.projects.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(k.tiles.find((t) => t.metric === 'completed')!.value).toBe(2);
    expect(k.tiles.find((t) => t.metric === 'onTime')!.value).toBe(50);
  });

  it('a project manager sees a team member’s KPIs counting ONLY the projects they run', async () => {
    const { service } = setup(world);
    const k = await service.personKpis(v('mgr'), 'ann', { kind: 'month' });
    expect(k.scope).toBe('manager');
    expect(k.projects.map((p) => p.id)).toEqual(['p1']);
    expect(k.tiles.find((t) => t.metric === 'completed')!.value).toBe(1);
    expect(k.tiles.find((t) => t.metric === 'onTime')!.value).toBe(100);
  });

  it('an administrator sees everyone’s, every project', async () => {
    const { service } = setup(world);
    const k = await service.personKpis(v('boss', true), 'ann', { kind: 'month' });
    expect(k.scope).toBe('admin');
    expect(k.tiles.find((t) => t.metric === 'completed')!.value).toBe(2);
  });

  it('a colleague is refused (403), and so is a manager of none of the person’s projects', async () => {
    const { service } = setup(world);
    await expect(service.personKpis(v('bob'), 'ann', { kind: 'month' })).rejects.toMatchObject({ status: 403 });
    await expect(service.personKpis(v('other'), 'bob', { kind: 'month' })).rejects.toMatchObject({ status: 403 });
    await expect(service.personItems(v('bob'), 'ann', 'onTime', { kind: 'month' })).rejects.toMatchObject({ status: 403 });
  });

  it('someone who isn’t a staff person (a client, a deleted account) is not found', async () => {
    const { service } = setup(world);
    await expect(service.personKpis(v('boss', true), 'client-1', { kind: 'month' })).rejects.toMatchObject({ status: 404 });
  });

  it('a manager’s drill-down lists only their projects’ tasks', async () => {
    const { service } = setup(world);
    const list = await service.personItems(v('mgr'), 'ann', 'completed', { kind: 'month' });
    expect(list.rows.map((r) => r.projectId)).toEqual(['p1']);
  });

  it('workload: planned hours against the hours they have (working days, less meetings)', async () => {
    const { service } = setup({ ...world, meetings: [{ userId: 'ann', startAt: at('2026-11-10', '09:00'), endAt: at('2026-11-10', '11:00') }] });
    const k = await service.personKpis(v('ann'), 'ann', { kind: 'week' });
    // Week of Sun 8 Nov: 5 working days × 9 h = 45 h, less a 2-hour meeting = 43 h.
    expect(k.workload).toMatchObject({ capacityHours: 43, meetingHours: 2, plannedHours: 54 });
    expect(k.tiles.find((t) => t.metric === 'workload')!.value).toBe(126);
    expect(k.tiles.find((t) => t.metric === 'workload')!.light).toBe('red');
  });
});

describe('a project’s KPIs', () => {
  it('tiles with values, targets, lights and words; the trend from snapshots plus this month live', async () => {
    const tasks = [done('2026-10-05', '2026-10-06'), done('2026-10-20', '2026-10-15'), done('2026-11-03', '2026-11-04'), done('2026-11-09', '2026-11-05'), task({ dueDate: dueAt('2026-11-02') })];
    const { service, job } = setup({ tasks });
    await job.run();
    const k = await service.projectKpis(v('mgr'), 'p1', { kind: 'month' });
    const onTime = k.tiles.find((t) => t.metric === 'onTime')!;
    expect(onTime).toMatchObject({ value: 50, target: 85, light: 'red', words: 'Off target', detail: '1 of 2 tasks finished on time', list: true });
    expect(k.trend.kind).toBe('month');
    expect(k.trend.points.map((p) => p.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    // June–September: nothing finished with a due day; October (stored) and November (live): 1 of 2.
    expect(onTime.trend).toEqual([null, null, null, null, 50, 50]);
    expect(k.trend.points[4]!.rebuilt).toBe(true);
    expect(k.trend.points[5]).toMatchObject({ current: true, rebuilt: false });
    const overdue = k.tiles.find((t) => t.metric === 'overdue')!;
    expect(overdue.value).toBe(100);
    expect(k.can.manage).toBe(true);
    const progress = k.tiles.find((t) => t.metric === 'progress')!;
    expect(progress.value).not.toBeNull();
  });

  it('a project override beats the company default; "no target" shows no light', async () => {
    const { service } = setup({ tasks: [done('2026-11-03', '2026-11-04')] });
    await service.saveProjectTargets(v('mgr'), 'p1', [{ metric: 'onTime', target: 95 }, { metric: 'daysLate', target: null }]);
    const k = await service.projectKpis(v('mgr'), 'p1', { kind: 'month' });
    expect(k.tiles.find((t) => t.metric === 'onTime')).toMatchObject({ target: 95, targetSource: 'project', light: 'green' });
    expect(k.tiles.find((t) => t.metric === 'daysLate')).toMatchObject({ target: null, light: 'none', words: 'No target' });
    // Back to the company's.
    await service.saveProjectTargets(v('mgr'), 'p1', [{ metric: 'onTime', inherit: true }]);
    expect((await service.projectKpis(v('mgr'), 'p1', { kind: 'month' })).tiles.find((t) => t.metric === 'onTime')!.targetSource).toBe('default');
  });

  it('only whoever runs the project (or an administrator) changes its targets', async () => {
    const { service } = setup();
    await expect(service.saveProjectTargets(v('bob'), 'p1', [{ metric: 'onTime', target: 95 }])).rejects.toMatchObject({ status: 403 });
    await expect(service.saveProjectTargets(v('mgr'), 'p1', [{ metric: 'onTime', target: -1 }])).rejects.toMatchObject({ status: 400 });
    await expect(service.saveProjectTargets(v('mgr'), 'p1', [{ metric: 'completed', target: 3 }])).rejects.toMatchObject({ status: 400 });
  });

  it('administrators set company defaults; a project without an override follows them', async () => {
    const { service } = setup({ tasks: [done('2026-11-03', '2026-11-04')] });
    const saved = await service.saveCompanyTargets(v('boss', true), 'c1', [{ metric: 'onTime', target: 90, amberBand: 5 }]);
    expect(saved.metrics.find((m) => m.metric === 'onTime')).toMatchObject({ target: 90, amberBand: 5, source: 'company', own: true });
    const k = await service.projectKpis(v('mgr'), 'p1', { kind: 'month' });
    expect(k.tiles.find((t) => t.metric === 'onTime')).toMatchObject({ target: 90, amberBand: 5, targetSource: 'company' });
    await expect(service.saveCompanyTargets(v('boss', true), 'nope', [])).rejects.toMatchObject({ status: 404 });
  });

  it('drill-down: the tasks behind a number, worst first; a list that doesn’t exist is refused', async () => {
    const { service } = setup({ tasks: [done('2026-11-03', '2026-11-04'), done('2026-11-09', '2026-11-05')] });
    const list = await service.projectItems('p1', 'onTime', { kind: 'month' });
    expect(list.total).toBe(2);
    expect(list.rows[0]).toMatchObject({ days: 2, tone: 'danger' });
    expect(list.rows[1]!.detail).toMatch(/^On time/);
    await expect(service.projectItems('p1', 'progress', { kind: 'month' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('a project’s own KPIs (owner 1)', () => {
  it('whoever runs it adds one, enters monthly values; the latest value gets a light', async () => {
    const { service } = setup();
    const after = await service.addCustom(v('mgr'), 'p1', { name: 'Safety incidents', unit: 'incidents', direction: 'LOWER', target: 0 });
    const k = after[0]!;
    expect(k).toMatchObject({ name: 'Safety incidents', light: 'nodata', due: '2026-10' });
    const withValue = await service.setCustomValue(v('mgr'), 'p1', k.id, '2026-10', { value: 1, note: 'Slip at rig 3' });
    expect(withValue[0]).toMatchObject({ latest: { month: '2026-10', value: 1 }, light: 'amber', due: null });
    expect(withValue[0]!.values.find((x) => x.month === '2026-10')).toMatchObject({ value: 1, note: 'Slip at rig 3' });
  });

  it('a team member can’t; a future month and a bad value are refused; at most 20', async () => {
    const { service } = setup();
    await expect(service.addCustom(v('bob'), 'p1', { name: 'X', unit: '', direction: 'HIGHER' })).rejects.toMatchObject({ status: 403 });
    const [k] = await service.addCustom(v('boss', true), 'p1', { name: 'Budget used', unit: '%', direction: 'LOWER', target: 80 });
    await expect(service.setCustomValue(v('mgr'), 'p1', k!.id, '2026-12', { value: 3 })).rejects.toMatchObject({ status: 400 });
    await expect(service.setCustomValue(v('mgr'), 'p1', k!.id, '2026-10', { value: 'lots' })).rejects.toMatchObject({ status: 400 });
    await expect(service.setCustomValue(v('other'), 'p2', k!.id, '2026-10', { value: 3 })).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 19; i++) await service.addCustom(v('mgr'), 'p1', { name: `K${i}`, unit: '', direction: 'HIGHER' });
    await expect(service.addCustom(v('mgr'), 'p1', { name: 'One more', unit: '', direction: 'HIGHER' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('the Management page’s KPI table', () => {
  it('an administrator gets every project; whoever runs one gets theirs; anyone else is refused', async () => {
    const { service } = setup({ tasks: [done('2026-11-03', '2026-11-04'), done('2026-11-04', '2026-11-02', { projectId: 'p2' })] });
    const all = await service.managementKpis(v('boss', true), DEFAULT_MANAGEMENT_FILTERS, null, { kind: 'month' });
    expect(all.scope).toBe('ALL');
    expect(all.rows.map((r) => r.project.id)).toEqual(['p1', 'p2']);
    expect(all.rows[1]!.figures.onTime).toMatchObject({ value: 0, light: 'red' });
    const mine = await service.managementKpis(v('mgr'), DEFAULT_MANAGEMENT_FILTERS, null, { kind: 'month' });
    expect(mine.rows.map((r) => r.project.id)).toEqual(['p1']);
    await expect(service.managementKpis(v('bob'), DEFAULT_MANAGEMENT_FILTERS, null, { kind: 'month' })).rejects.toMatchObject({ status: 403 });
    await expect(service.managementKpis(v('mgr'), { ...DEFAULT_MANAGEMENT_FILTERS, projectIds: ['p2'] }, null, { kind: 'month' })).rejects.toMatchObject({ status: 404 });
  });
});
