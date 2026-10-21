import { describe, it, expect, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { afterTaskDeleted, afterTaskSaved, assignmentRefreshes, createdTaskRefreshes, editRefreshes, moveRefreshes } from './task-cache';
import { refresh } from './refresh';
import type { ApiTask } from './types';

const t = (id: string, over: Partial<ApiTask> = {}): ApiTask => ({
  id,
  key: `T-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
  ...over,
});

const clients: QueryClient[] = [];
afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
});

/** A cache as task details over a board leaves it: the task, its parts, lists and project data. */
function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  clients.push(qc);
  qc.setQueryData(['task', 't1'], { ...t('t1'), version: 3, meeting: { id: 'm1', title: 'Weekly', startAt: null, canView: true } });
  for (const part of ['tags', 'assignees', 'checklist', 'comments', 'mentionable', 'attachments', 'activity', 'dependencies', 'watch', 'watchers']) {
    qc.setQueryData(['task', 't1', part], []);
  }
  qc.setQueryData(['tasks', 'project', 'p1', '2026-10-21'], [t('t1'), t('t2')]);
  qc.setQueryData(['tasks', 'project', 'p1', '2026-10-20'], [t('t3')]);
  qc.setQueryData(['tasks', 'mine'], [t('t2')]);
  qc.setQueryData(['project', 'p1', 'progress'], {});
  qc.setQueryData(['project', 'p1', 'members'], []);
  qc.setQueryData(['project', 'p1', 'details'], {});
  qc.setQueryData(['project', 'p2', 'progress'], {});
  qc.setQueryData(['task', 't2'], t('t2'));
  return qc;
}

const refreshedKeys = (qc: QueryClient) =>
  qc
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.isInvalidated)
    .map((q) => JSON.stringify(q.queryKey))
    .sort();

describe('afterTaskSaved (an edit refreshes what it changed, not the whole task and every list)', () => {
  it('shows the saved task at once, keeping what only its details call returns', () => {
    const qc = seeded();
    afterTaskSaved(qc, 't1', { ...t('t1'), title: 'Renamed', version: 4 }, { title: 'Renamed' });
    const detail = qc.getQueryData<ApiTask & { meeting?: unknown }>(['task', 't1']);
    expect(detail?.title).toBe('Renamed');
    expect(detail?.version).toBe(4);
    expect(detail?.meeting).toEqual({ id: 'm1', title: 'Weekly', startAt: null, canView: true });
  });

  it('keeps the saved task when an older load of its details lands after the save', async () => {
    const qc = seeded();
    let answer!: (task: ApiTask) => void;
    // A load of the details started before the save's answer came (the app came back to the front)…
    const loading = qc.fetchQuery({ queryKey: ['task', 't1'], queryFn: () => new Promise<ApiTask>((r) => (answer = r)), staleTime: 0 });
    // …the save's answer arrives first…
    afterTaskSaved(qc, 't1', { ...t('t1'), title: 'Renamed', version: 4 }, { title: 'Renamed' });
    // …and the older load lands after it, with the task as it was before the edit.
    answer({ ...t('t1'), title: 'Old', version: 3 });
    await loading.catch(() => {});
    const detail = qc.getQueryData<ApiTask & { meeting?: unknown }>(['task', 't1']);
    expect(detail?.title).toBe('Renamed');
    expect(detail?.version).toBe(4);
    expect(detail?.meeting).toEqual({ id: 'm1', title: 'Weekly', startAt: null, canView: true });
  });

  it('refreshes the task’s activity and the lists that show it, nothing else', () => {
    const qc = seeded();
    afterTaskSaved(qc, 't1', { ...t('t1'), title: 'Renamed', version: 4 }, { title: 'Renamed' });
    expect(refreshedKeys(qc)).toEqual(['["task","t1","activity"]', '["tasks","project","p1","2026-10-21"]']);
  });

  it('refreshes the project’s progress too when the due date changes', () => {
    const qc = seeded();
    afterTaskSaved(qc, 't1', { ...t('t1'), dueDate: '2026-10-30' }, { dueDate: '2026-10-30' });
    expect(refreshedKeys(qc)).toContain('["project","p1","progress"]');
    expect(refreshedKeys(qc)).not.toContain('["project","p2","progress"]');
  });

  it('refreshes the task itself when the server sent no copy back', () => {
    const qc = seeded();
    afterTaskSaved(qc, 't1', undefined, { title: 'Renamed' });
    expect(refreshedKeys(qc)).toContain('["task","t1"]');
  });

  it('refreshes every list and every task’s details after a change to a whole series', () => {
    const qc = seeded();
    afterTaskSaved(qc, 't1', t('t1', { title: 'All' }), { title: 'All', scope: 'series' });
    const keys = refreshedKeys(qc);
    expect(keys).toEqual(
      expect.arrayContaining(['["tasks","project","p1","2026-10-20"]', '["tasks","mine"]', '["task","t2"]', '["task","t1","activity"]']),
    );
    expect(keys).not.toContain('["task","t1","comments"]');
  });
});

describe('editRefreshes', () => {
  it('names the activity and the lists holding the task', () => {
    expect(editRefreshes('t1', { title: 'x' })).toEqual([{ queryKey: ['task', 't1', 'activity'], exact: true }, { listsHolding: 't1' }]);
  });

  it('adds the project progress for a due date or a column change', () => {
    expect(editRefreshes('t1', { dueDate: null })).toContainEqual({ progressFor: 't1' });
    expect(editRefreshes('t1', { columnId: 'c2' })).toContainEqual({ progressFor: 't1' });
    expect(editRefreshes('t1', { priority: 'HIGH' })).not.toContainEqual({ progressFor: 't1' });
  });

  it('a new due day or repeat refreshes every calendar range: the task may now be on a day of one that didn’t hold it (5a)', () => {
    expect(editRefreshes('t1', { dueDate: '2026-10-21' })).toContainEqual({ queryKey: ['tasks', 'calendar'] });
    expect(editRefreshes('t1', { recurrenceRule: null })).toContainEqual({ queryKey: ['tasks', 'calendar'] });
    expect(editRefreshes('t1', { title: 'x' })).not.toContainEqual({ queryKey: ['tasks', 'calendar'] });
  });
});

describe('createdTaskRefreshes', () => {
  it('a new task: its project’s board days, My Tasks, the project’s progress and the calendar’s ranges (5a)', () => {
    expect(createdTaskRefreshes('p1')).toEqual([
      { queryKey: ['tasks', 'project', 'p1'] },
      { queryKey: ['tasks', 'mine'] },
      { queryKey: ['project', 'p1', 'progress'], exact: true },
      { queryKey: ['tasks', 'calendar'] },
    ]);
  });
});

describe('moveRefreshes', () => {
  it('names the task, its activity, its project’s board days, the lists holding it and the progress', () => {
    const qc = seeded();
    qc.setQueryData(['tasks', 'mine'], [t('t1')]);
    refresh(qc, moveRefreshes('t1', 'p1'));
    expect(refreshedKeys(qc)).toEqual([
      '["project","p1","progress"]',
      '["task","t1","activity"]',
      '["task","t1"]',
      '["tasks","mine"]',
      '["tasks","project","p1","2026-10-20"]',
      '["tasks","project","p1","2026-10-21"]',
    ]);
  });

  it('leaves My Tasks alone when the task isn’t in it', () => {
    const qc = seeded();
    refresh(qc, moveRefreshes('t1', 'p1'));
    expect(refreshedKeys(qc)).not.toContain('["tasks","mine"]');
    expect(refreshedKeys(qc)).not.toContain('["task","t1","comments"]');
  });

  it('refreshes My Action Items (open and all): an action item follows its task into Done and out of it', () => {
    const qc = seeded();
    qc.setQueryData(['action-items', 'mine', 'open'], []);
    qc.setQueryData(['action-items', 'mine', 'all'], []);
    refresh(qc, moveRefreshes('t1', 'p1'));
    expect(refreshedKeys(qc)).toEqual(expect.arrayContaining(['["action-items","mine","open"]', '["action-items","mine","all"]']));
  });
});

describe('afterTaskDeleted', () => {
  it('drops the task, refreshes the lists that held it and its project’s figures', () => {
    const qc = seeded();
    qc.setQueryData(['project', 'p1', 'meetings'], null);
    afterTaskDeleted(qc, 't1');
    expect(qc.getQueryData(['task', 't1'])).toBeUndefined();
    expect(qc.getQueryData(['task', 't1', 'comments'])).toBeUndefined();
    expect(refreshedKeys(qc)).toEqual(['["project","p1","meetings"]', '["project","p1","progress"]', '["tasks","project","p1","2026-10-21"]']);
  });

  it('refreshes the project’s lists, My Tasks and the other copies after deleting a series', () => {
    const qc = seeded();
    afterTaskDeleted(qc, 't1', 'series');
    expect(refreshedKeys(qc)).toEqual(
      expect.arrayContaining(['["tasks","project","p1","2026-10-20"]', '["tasks","mine"]', '["task","t2"]', '["project","p1","progress"]']),
    );
    expect(refreshedKeys(qc)).not.toContain('["project","p2","progress"]');
  });
});

describe('afterTaskSaved when the task’s details were never loaded (5a review: a move from the calendar)', () => {
  it('doesn’t make the details from the save’s answer — it has no "From meeting" — so they load in full when opened', () => {
    const qc = seeded();
    qc.removeQueries({ queryKey: ['task', 't1'], exact: true });
    afterTaskSaved(qc, 't1', { ...t('t1'), dueDate: '2026-10-30', version: 4 }, { dueDate: '2026-10-30' });
    expect(qc.getQueryData(['task', 't1'])).toBeUndefined();
  });

  it('a first load of the details on its way (it may have been answered before the save) is called off and marked to load again', async () => {
    const qc = seeded();
    qc.removeQueries({ queryKey: ['task', 't1'], exact: true });
    let answer!: (task: ApiTask) => void;
    const loading = qc.fetchQuery({ queryKey: ['task', 't1'], queryFn: () => new Promise<ApiTask>((r) => (answer = r)), staleTime: 0 });
    afterTaskSaved(qc, 't1', { ...t('t1'), dueDate: '2026-10-30', version: 4 }, { dueDate: '2026-10-30' });
    answer({ ...t('t1'), version: 3 });
    await loading.catch(() => {});
    expect(qc.getQueryData(['task', 't1'])).toBeUndefined();
    expect(qc.getQueryState(['task', 't1'])?.isInvalidated).toBe(true);
  });
});

describe('assignmentRefreshes (5a review: an assignment change reaches the calendar)', () => {
  it('refreshes the task’s people and activity, My Tasks and every list holding it — the calendar’s ranges too', () => {
    const qc = seeded();
    const RANGE = ['tasks', 'calendar', '2026-09-27', '2026-10-31'];
    qc.setQueryData(RANGE, { from: '2026-09-27', to: '2026-10-31', timeZone: 'Asia/Muscat', tasks: [t('t1')], occurrences: [], series: [] });
    refresh(qc, assignmentRefreshes('t1'));
    expect(refreshedKeys(qc)).toEqual(
      expect.arrayContaining(['["task","t1","assignees"]', '["task","t1","activity"]', '["tasks","mine"]', JSON.stringify(RANGE), '["tasks","project","p1","2026-10-21"]']),
    );
    expect(refreshedKeys(qc)).not.toContain('["task","t1","comments"]');
  });
});

describe('assignmentRefreshes and the replay of a kept assignment', () => {
  it('refresh the same (a change made online and one replayed later must not drift apart)', async () => {
    const { refreshesAfterReplay } = await import('./perform-mutation');
    expect(refreshesAfterReplay({ kind: 'task.assign', payload: { id: 't1', userIds: ['u2'] } })).toEqual(assignmentRefreshes('t1'));
    expect(refreshesAfterReplay({ kind: 'task.unassign', payload: { id: 't1', userId: 'u2' } })).toEqual(assignmentRefreshes('t1'));
  });
});
