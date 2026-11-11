/** The KPI service over in-memory stores and a memory source (service, export and route tests). */
import { createKpiEngine } from './kpi-engine';
import { createKpiService, type KpiAccess } from './kpi-service';
import { createMemoryKpiSource, projectRow, type MemoryKpiWorld } from './kpi-source.fixture';
import { createMemoryCustomKpiStore, createMemorySnapshotStore, createMemoryTargetStore } from './kpi-stores';
import { createSnapshotJob, type SnapshotState } from './kpi-snapshots';
import type { KpiTask } from './task-history';
import type { MgmtProject } from '../management/management-source';

export const TZ = 'Asia/Muscat';
export const at = (day: string, hhmm = '10:00') => new Date(`${day}T${hhmm}:00+04:00`);
export const dueAt = (day: string) => new Date(`${day}T12:00:00.000Z`);
let n = 0;
export function task(over: Partial<KpiTask> = {}): KpiTask {
  n += 1;
  return {
    id: `t${n}`,
    key: `P-${n}`,
    title: `Task ${n}`,
    projectId: 'p1',
    createdAt: at('2026-09-01', '08:00'),
    updatedAt: at('2026-09-01', '08:00'),
    startDate: null,
    dueDate: null,
    completedAt: null,
    columnCategory: 'TODO',
    approvalRequestedAt: null,
    priority: 'NORMAL',
    weight: null,
    assignees: [{ userId: 'ann', assignedAt: at('2026-09-01', '08:00') }],
    events: [],
    ...over,
  };
}
export const done = (day: string, due: string | null, over: Partial<KpiTask> = {}) => task({ columnCategory: 'DONE', completedAt: at(day), dueDate: due ? dueAt(due) : null, ...over });

// p1 is run by `mgr` (ann and bob on it); p2 is run by `other` (ann on it). `boss` is an administrator.
export const RUNS: Record<string, string[]> = { mgr: ['p1'], other: ['p2'], boss: [] };
export const ON: Record<string, string[]> = { ann: ['p1', 'p2'], bob: ['p1'], mgr: ['p1'], other: ['p2'], boss: [] };

export function setup(world: Partial<MemoryKpiWorld> = {}, nowDay = '2026-11-11') {
  const w: MemoryKpiWorld = {
    projects: [projectRow('p1', { managerId: 'mgr', startDate: dueAt('2026-09-01'), targetDate: dueAt('2026-12-31') }), projectRow('p2', { managerId: 'other' })],
    tasks: [],
    admins: ['boss'],
    people: ['ann', 'bob', 'mgr', 'other', 'boss'].map((id) => ({ id, name: id.toUpperCase(), avatarUrl: null })),
    ...world,
  };
  const source = createMemoryKpiSource(w);
  const now = () => at(nowDay, '15:00');
  const rules = async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4], holidays: [] }, hours: { start: '08:00', end: '17:00' } });
  const engine = createKpiEngine({ source, timeZone: TZ, rules, now });
  const access: KpiAccess = {
    canManageProject: async (u, roles, p) => roles.includes('ADMIN') || (RUNS[u] ?? []).includes(p),
    visibleProjectIds: async (v) => (v.roles.includes('ADMIN') ? null : ON[v.id] ?? []),
    runProjectIds: async (u) => RUNS[u] ?? [],
    personProjectIds: async (u) => ON[u] ?? [],
    person: async (u) => (ON[u] ? { id: u, name: u.toUpperCase(), avatarUrl: null, companyId: 'c1', active: true } : null),
  };
  const mgmt = (p: string): MgmtProject => ({ id: p, code: p.toUpperCase(), name: `Project ${p}`, status: 'ACTIVE', color: '#000', icon: null, imageUrl: null, ownerId: null, updatedAt: new Date() }) as MgmtProject;
  const targets = createMemoryTargetStore();
  const custom = createMemoryCustomKpiStore();
  const snapshots = createMemorySnapshotStore();
  const service = createKpiService({
    engine,
    source,
    snapshots,
    targets,
    custom,
    planned: { plannedHours: async () => 54 },
    access,
    management: {
      projects: async (runBy) => (runBy ? (RUNS[runBy] ?? []).map(mgmt) : ['p1', 'p2'].map(mgmt)),
      runCount: async (u) => (RUNS[u] ?? []).length,
    },
    rules,
    weekStart: async () => 0,
    companies: async () => [{ id: 'c1', name: 'Prolens' }],
    timeZone: TZ,
    now,
  });
  let state: SnapshotState = { launchDay: null, rebuiltAt: null, lastNightlyDay: null };
  const job = createSnapshotJob({ engine, source, store: snapshots, state: { get: async () => state, set: async (s) => void (state = s) }, projectIds: async () => ['p1', 'p2'], weekStart: async () => 0, timeZone: TZ, now });
  return { service, w, targets, custom, snapshots, job };
}

export const v = (id: string, admin = false) => ({ id, roles: admin ? ['ADMIN'] : ['EMPLOYEE'] });
