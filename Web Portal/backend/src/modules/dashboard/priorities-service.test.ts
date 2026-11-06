import { describe, it, expect, vi } from 'vitest';
import { createPrioritiesService, PRIORITY_LIMIT } from './priorities-service';
import { CHECKLIST_ITEMS_STUB, type PrioritySource, type SourcedCandidate, type TaskRowData } from './priority-sources';

// 1.23.4 — "My Priorities Today" put together: every source's rows ranked as one list, the counts, the
// checklist-items hook (1.23.3), the 30-second cache and what clears it.
const NOW = new Date('2026-11-06T08:00:00Z'); // 12:00 in Muscat
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const me = { id: 'me', roles: ['EMPLOYEE'] };

const taskRow = (id: string): TaskRowData => ({
  id,
  key: id.toUpperCase(),
  title: `Task ${id}`,
  priority: 'NORMAL',
  dueDate: null,
  startDate: null,
  startAt: null,
  version: 1,
  columnId: 'c1',
  project: { id: 'p1', code: 'RIG', name: 'Rig', color: null, icon: null, imageUrl: null },
  assignees: [{ id: 'me', name: 'Me' }],
  blockers: [],
  doneColumnId: 'done',
  recurrenceRule: null,
  can: { complete: true, reschedule: true, assign: true, approve: false },
});
const ownTask = (id: string, due: string | null, extra: Partial<SourcedCandidate> = {}): SourcedCandidate => ({
  kind: 'task',
  id,
  key: id.toUpperCase(),
  priority: 'NORMAL',
  dueDate: due ? day(due) : null,
  createdAt: day('2026-10-01'),
  columnCategory: 'TODO',
  assigneeIds: ['me'],
  mine: true,
  team: false,
  blockers: [],
  dependents: 0,
  row: { task: taskRow(id) },
  watch: ['p1'],
  ...extra,
} as SourcedCandidate);
const source = (name: string, rows: SourcedCandidate[] | (() => SourcedCandidate[])): PrioritySource & { calls: number } => {
  const s = {
    name,
    calls: 0,
    async collect() {
      s.calls += 1;
      return typeof rows === 'function' ? rows() : rows;
    },
  };
  return s;
};
const service = (sources: PrioritySource[], over: Partial<Parameters<typeof createPrioritiesService>[0]> = {}) =>
  createPrioritiesService({ sources, timeZone: 'Asia/Muscat', isManager: async () => false, now: () => NOW, ...over });

describe('one ranked list from every source', () => {
  it('ranks the rows of every source together, with their reasons, chips, counts and the projects to listen to', async () => {
    const tasks = source('tasks', [ownTask('a', '2026-11-08'), ownTask('b', '2026-11-04'), ownTask('c', '2026-12-30')]);
    const items = source('action-items', [
      {
        kind: 'action-item',
        id: 'ai1',
        key: null,
        priority: 'NORMAL',
        dueDate: day('2026-11-06'),
        createdAt: day('2026-10-01'),
        row: { actionItem: { id: 'ai1', description: 'Send the report', dueDate: '2026-11-06', priority: 'NORMAL', status: 'OPEN', meeting: null, projectId: 'p2', can: { done: true, reschedule: true } } },
        watch: ['p2'],
      },
    ]);
    const answer = await service([tasks, items]).get(me, null);
    expect(answer.today).toBe('2026-11-06');
    expect(answer.items.map((r) => r.id)).toEqual(['task:b', 'action-item:ai1', 'task:a']);
    expect(answer.items[0]).toMatchObject({ kind: 'task', reason: { code: 'overdue', days: 2 }, also: [], chips: ['overdue'], group: 1, task: { id: 'b', key: 'B' } });
    expect(answer.items[1]).toMatchObject({ kind: 'action-item', reason: { code: 'due-today' }, actionItem: { id: 'ai1' } });
    expect(answer.total).toBe(3);
    expect(answer.counts).toEqual({ all: 3, overdue: 1, today: 1, approvals: 0, blocked: 0, upcoming: 1, team: 0 });
    expect(answer.watch).toEqual(['p1', 'p2']);
    expect(answer.manager).toBe(false);
  });

  it('says whether the person runs projects (the Team chip)', async () => {
    expect((await service([], { isManager: async (v) => v.id === 'boss' }).get({ id: 'boss', roles: [] }, null)).manager).toBe(true);
  });

  it('shows at most the 300 most urgent rows, with the true totals', async () => {
    const many = Array.from({ length: PRIORITY_LIMIT + 5 }, (_, i) => ownTask(`t${i}`, '2026-11-05'));
    const answer = await service([source('tasks', many)]).get(me, null);
    expect(PRIORITY_LIMIT).toBe(300);
    expect(answer.items).toHaveLength(300);
    expect(answer.total).toBe(305);
    expect(answer.counts.overdue).toBe(305);
  });

  it('an action item tracked as a task that is a row itself is left out (the task stands for it)', async () => {
    const item = (id: string, linked: string | null): SourcedCandidate => ({
      kind: 'action-item',
      id,
      key: null,
      priority: 'NORMAL',
      dueDate: day('2026-11-05'),
      createdAt: day('2026-10-01'),
      row: { actionItem: { id, description: id, dueDate: '2026-11-05', priority: 'NORMAL', status: 'OPEN', meeting: null, projectId: null, can: { done: true, reschedule: true } } },
      watch: [],
      linkedTaskId: linked,
    });
    const answer = await service([source('tasks', [ownTask('t1', '2026-11-05')]), source('items', [item('tracked', 't1'), item('other-task', 't9'), item('free', null)])]).get(me, null);
    expect(answer.items.map((r) => r.id).sort()).toEqual(['action-item:free', 'action-item:other-task', 'task:t1']);
  });

  it('a source that fails fails the whole answer — an outage never reads as “nothing urgent”', async () => {
    const broken: PrioritySource = { name: 'tasks', collect: async () => Promise.reject(new Error('db down')) };
    await expect(service([broken, source('items', [])]).get(me, null)).rejects.toThrow('db down');
  });
});

describe('the checklist-items hook (1.23.3 plugs in its source here)', () => {
  it('until then the stub gives nothing', async () => {
    expect(await CHECKLIST_ITEMS_STUB.collect({ viewer: me, pick: null, today: '2026-11-06', timeZone: 'Asia/Muscat' })).toEqual([]);
    expect(CHECKLIST_ITEMS_STUB.name).toBe('checklist-items');
  });

  it('a checklist source’s items are ranked with the rest: overdue first, today with today, upcoming last', async () => {
    const item = (id: string, due: string): SourcedCandidate => ({
      kind: 'checklist-item',
      id,
      key: null,
      priority: 'NORMAL',
      dueDate: day(due),
      createdAt: day('2026-10-01'),
      row: { checklistItem: { id, text: `Step ${id}`, dueDate: due, task: { id: 't1', key: 'RIG-1', title: 'Pump', projectId: 'p1' }, can: { tick: true, reschedule: true } } },
      watch: ['p1'],
    });
    const checklist = source('checklist-items', [item('late', '2026-11-03'), item('soon', '2026-11-09'), item('later', '2026-11-20')]);
    const answer = await service([source('tasks', [ownTask('t1', '2026-11-06')]), checklist]).get(me, null);
    expect(answer.items.map((r) => r.id)).toEqual(['checklist-item:late', 'task:t1', 'checklist-item:soon']);
    expect(answer.items[0]).toMatchObject({ kind: 'checklist-item', reason: { code: 'overdue', days: 3 }, checklistItem: { id: 'late', task: { key: 'RIG-1' } } });
    expect(answer.counts).toMatchObject({ all: 3, overdue: 1, today: 1, upcoming: 1 });
  });
});

describe('cached per person for 30 seconds', () => {
  it('a second look within 30 s is served from the cache; after 30 s, or asked fresh, it is read again', async () => {
    let now = NOW.getTime();
    const tasks = source('tasks', [ownTask('a', '2026-11-05')]);
    const s = service([tasks], { now: () => new Date(now) });
    await s.get(me, null);
    await s.get(me, null);
    expect(tasks.calls).toBe(1);
    await s.get(me, null, { fresh: true });
    expect(tasks.calls).toBe(2);
    now += 30_001;
    await s.get(me, null);
    expect(tasks.calls).toBe(3);
  });

  it('each person and each picked company has its own entry', async () => {
    const tasks = source('tasks', []);
    const s = service([tasks]);
    await s.get(me, null);
    await s.get(me, 'company-a');
    await s.get({ id: 'other', roles: [] }, null);
    expect(tasks.calls).toBe(3);
  });

  it('any change (a task event, an action item) clears it; one person’s own change clears theirs', async () => {
    const tasks = source('tasks', []);
    const s = service([tasks]);
    await s.get(me, null);
    s.changed();
    await s.get(me, null);
    expect(tasks.calls).toBe(2);
    await s.get({ id: 'other', roles: [] }, null);
    s.changedFor('me');
    await s.get(me, null);
    await s.get({ id: 'other', roles: [] }, null);
    expect(tasks.calls).toBe(4);
  });

  it('an answer read while a change happened is not kept', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const rows = vi.fn(() => []);
    const slow: PrioritySource = { name: 'tasks', collect: async () => { await gate; return rows(); } };
    const s = service([slow]);
    const first = s.get(me, null);
    s.changed();
    release();
    await first;
    await s.get(me, null);
    expect(rows).toHaveBeenCalledTimes(2);
  });
});
