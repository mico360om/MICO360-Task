import { describe, it, expect, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { afterApprovalDecision, afterApprovalRefused, afterTaskMoved, afterTasksMoved, projectMoveRefreshes, afterTaskDeleted, afterTaskSaved, approvalRefreshes, assignmentRefreshes, createdTaskRefreshes, editRefreshes, moveRefreshes, DASHBOARD_VIEWS, TASK_FIGURE_VIEWS } from './task-cache';
import { appSource } from '../testing/web-source';
import { refresh } from './refresh';
import type { ApiTask, MoveResult } from './types';
import { formerKeysText } from './task-detail';

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
    expect(editRefreshes('t1', { title: 'x' })).toEqual([{ queryKey: ['task', 't1', 'activity'], exact: true }, { listsHolding: 't1' }, ...TASK_FIGURE_VIEWS]);
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
      ...TASK_FIGURE_VIEWS,
    ]);
  });
});

// Stage 3 final review P1: a task changed on a screen opened from Timeline, Workload or Management
// (a day's task, a project's task row) leaves their figures out of date — marked so and read again
// when they are next shown, as the website's TASK_FIGURE_KEYS / invalidateTaskQueries.
describe('Timeline, Workload and Management after a task change', () => {
  it('are named by every task change: an edit, a new task, its people, a move, an approval decision, a move to another project and a delete', () => {
    expect(TASK_FIGURE_VIEWS).toEqual([{ queryKey: ['planning'], later: true }, { queryKey: ['management'], later: true }, ...DASHBOARD_VIEWS]);
    // Stage 2's approval decisions and moves to another project too (Management counts what waits for approval; Timeline each project's tasks).
    const moved = { task: t('t1'), from: { projectId: 'p1' }, to: { projectId: 'p2' } } as MoveResult;
    for (const list of [editRefreshes('t1', { title: 'x' }), createdTaskRefreshes('p1'), assignmentRefreshes('t1'), moveRefreshes('t1', 'p1'), approvalRefreshes('t1'), projectMoveRefreshes(moved)]) {
      for (const v of TASK_FIGURE_VIEWS) expect(list).toContainEqual(v);
    }
  });

  it('are marked out of date, not fetched at once; who may open Management is left alone', () => {
    const qc = seeded();
    qc.setQueryData(['planning', 'u1', 'timeline', 'a', 'b', 1, '2026-10-31'], { projects: [] });
    qc.setQueryData(['planning', 'u1', 'workload', '2026-10-25', '', '2026-10-31'], { people: [] });
    qc.setQueryData(['management', 'u1', 'overview', 'weeks=12'], { tiles: {} });
    qc.setQueryData(['management-access', 'u1'], { allowed: true });
    afterTaskDeleted(qc, 't1');
    const keys = refreshedKeys(qc);
    for (const k of ['["planning","u1","timeline","a","b",1,"2026-10-31"]', '["planning","u1","workload","2026-10-25","","2026-10-31"]', '["management","u1","overview","weeks=12"]']) expect(keys).toContain(k);
    expect(keys).not.toContain('["management-access","u1"]');
    expect(qc.getQueryCache().findAll({ queryKey: ['planning'] }).every((q) => q.state.fetchStatus === 'idle')).toBe(true);
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

describe('approvals: Approve, Send back and the "Needs approval" switch (Stage 2)', () => {
  it('a decision refreshes the task, its comments and history, the lists, the approvals and the project counts', () =>
    expect(approvalRefreshes('t1')).toEqual([{ queryKey: ['task', 't1'], exact: true }, { queryKey: ['task', 't1', 'comments'] }, { queryKey: ['task', 't1', 'activity'] }, { listsHolding: 't1' }, { progressFor: 't1' }, { queryKey: ['approvals'] }, { queryKey: ['projects'], later: true }, ...TASK_FIGURE_VIEWS]));

  it('shows the server’s answer at once over the details shown (keeping what only the details call returns), then refreshes', () => {
    const qc = seeded();
    qc.setQueryData(['approvals'], { canApprove: true, tasks: [] });
    afterApprovalDecision(qc, 't1', { ...t('t1'), approvalRequestedAt: null, completedAt: '2026-10-30T08:00:00Z', version: 4 });
    const detail = qc.getQueryData<ApiTask & { meeting?: unknown }>(['task', 't1']);
    expect(detail).toMatchObject({ completedAt: '2026-10-30T08:00:00Z', approvalRequestedAt: null, version: 4 });
    expect(detail?.meeting).toEqual({ id: 'm1', title: 'Weekly', startAt: null, canView: true });
    expect(refreshedKeys(qc)).toEqual(expect.arrayContaining(['["task","t1"]', '["task","t1","comments"]', '["task","t1","activity"]', '["tasks","project","p1","2026-10-21"]', '["project","p1","progress"]', '["approvals"]']));
  });

  it('details never loaded (a decision from To approve) are not made from the answer: they load in full when opened', () => {
    const qc = seeded();
    qc.removeQueries({ queryKey: ['task', 't1'], exact: true });
    afterApprovalDecision(qc, 't1', { ...t('t1'), version: 4 });
    expect(qc.getQueryData(['task', 't1'])).toBeUndefined();
  });

  it('a refused decision (changed meanwhile, decided by someone else) reloads the task and the approvals list, so a retry is from what is there now', () => {
    const qc = seeded();
    qc.setQueryData(['approvals'], { canApprove: true, tasks: [] });
    afterApprovalRefused(qc, 't1');
    expect(refreshedKeys(qc)).toEqual(['["approvals"]', '["task","t1"]']);
  });
});

describe('editRefreshes and "Needs approval" (Stage 2)', () => {
  it('turning it on or off refreshes the approvals list and the project’s progress (off while it waits marks it done)', () => {
    expect(editRefreshes('t1', { needsApproval: false })).toEqual(expect.arrayContaining([{ queryKey: ['approvals'] }, { progressFor: 't1' }]));
    expect(editRefreshes('t1', { title: 'x' })).not.toContainEqual({ queryKey: ['approvals'] });
  });
});

describe('a task moved to another project (Stage 2)', () => {
  it('Review Focus 3: after a move the task’s screen shows the new number and "Formerly", and both boards are read again', () => {
    const qc = new QueryClient(); clients.push(qc);
    qc.setQueryData(['task', 't1'], { id: 't1', key: 'RIG-4', projectId: 'p1', title: 'Check pumps' });
    afterTaskMoved(qc, { task: { id: 't1', key: 'OPS-17', projectId: 'p2', formerKeys: ['RIG-4'] }, from: { projectId: 'p1', name: 'Rig', key: 'RIG-4' }, to: { projectId: 'p2', name: 'Operations', key: 'OPS-17' } } as MoveResult);
    const t = qc.getQueryData<ApiTask>(['task', 't1'])!; expect(t).toMatchObject({ key: 'OPS-17', projectId: 'p2', title: 'Check pumps' }); expect(formerKeysText(t.formerKeys)).toBe('Formerly RIG-4');
    expect(projectMoveRefreshes({ task: t, from: { projectId: 'p1' }, to: { projectId: 'p2' } } as MoveResult)).toEqual([{ queryKey: ['tasks'] }, { queryKey: ['projects'] }, { queryKey: ['project', 'p1'] }, { queryKey: ['project', 'p2'] }, { queryKey: ['task', 't1'] }, { queryKey: ['approvals'] }, ...TASK_FIGURE_VIEWS]);
  });
  it('lists of both projects are read again; a task never opened isn’t made from the answer', () => {
    const qc = seeded();
    qc.removeQueries({ queryKey: ['task', 't1'], exact: true });
    afterTaskMoved(qc, { task: { ...t('t1'), key: 'OPS-17', projectId: 'p2' }, from: { projectId: 'p1', name: 'Rig', key: 'T-t1' }, to: { projectId: 'p2', name: 'Operations', key: 'OPS-17' } } as MoveResult);
    expect(qc.getQueryData(['task', 't1'])).toBeUndefined();
    expect(refreshedKeys(qc)).toEqual(expect.arrayContaining(['["tasks","project","p1","2026-10-21"]', '["tasks","mine"]', '["project","p1","progress"]', '["project","p2","progress"]']));
  });
});

describe('several tasks moved at once (Stage 2)', () => {
  it('each moved task shows its new number; what they changed is read again once, not once per task', async () => {
    const qc = seeded();
    qc.setQueryData(['task', 't2'], { ...t('t2'), key: 'T-t2' });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const moved = (id: string, key: string) => ({ task: { ...t(id), key, projectId: 'p2' }, from: { projectId: 'p1', name: 'Rig', key: `T-${id}` }, to: { projectId: 'p2', name: 'Operations', key } }) as MoveResult;
    afterTasksMoved(qc, [moved('t1', 'OPS-1'), moved('t2', 'OPS-2')]);
    expect(qc.getQueryData<ApiTask>(['task', 't1'])?.key).toBe('OPS-1'); expect(qc.getQueryData<ApiTask>(['task', 't2'])?.key).toBe('OPS-2');
    // One refresh for the group (refresh() reads now what is shown, and marks the rest): not one per task.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(refreshedKeys(qc)).toEqual(expect.arrayContaining(['["task","t1"]', '["task","t2"]', '["tasks","mine"]', '["project","p1","progress"]', '["project","p2","progress"]']));
  });
});

// Stage 2 final review A2: once decided (approved, sent back, or approval switched off) a task leaves
// "To approve" and the Dashboard's card at once, so its buttons can't be tapped again before the list is read.
describe('a decided task leaves the approvals list at once', () => {
  it('Approve, Send back and switching off take it off the list now, and the list is still read again', () => {
    for (const answer of [
      { ...t('t1'), approvalRequestedAt: null, completedAt: '2026-10-30T08:00:00Z' }, // approved
      { ...t('t1'), approvalRequestedAt: null }, // sent back
      { ...t('t1'), approvalRequestedAt: null, needsApproval: false, completedAt: '2026-10-30T08:00:00Z' }, // switched off while it waited
    ]) {
      const qc = seeded();
      qc.setQueryData(['approvals'], { canApprove: true, tasks: [{ ...t('t1'), project: { id: 'p1' } }, { ...t('t2'), project: { id: 'p1' } }] });
      afterApprovalDecision(qc, 't1', answer);
      expect(qc.getQueryData<{ tasks: { id: string }[] }>(['approvals'])?.tasks.map((x) => x.id)).toEqual(['t2']);
      expect(qc.getQueryData<{ canApprove: boolean }>(['approvals'])?.canApprove).toBe(true);
      expect(refreshedKeys(qc)).toContain('["approvals"]');
    }
  });
  it('no list read yet: nothing is made', () => {
    const qc = seeded();
    afterApprovalDecision(qc, 't1', { ...t('t1'), approvalRequestedAt: null });
    expect(qc.getQueryData(['approvals'])).toBeUndefined();
  });
});

// Stage 2 final review A9: the Dashboard's admin totals, its activity feed and Due soon count tasks too —
// every task change marks them out of date (read again when the Dashboard is next shown), as the
// website's TASK_QUERY_ROOTS.
describe('the Dashboard after a task change (final review A9)', () => {
  it('admin totals, the activity feed and Due soon are named by every task change, with Timeline, Workload and Management', () => {
    expect(DASHBOARD_VIEWS).toEqual([{ queryKey: ['dashboard'], later: true }, { queryKey: ['activity'], later: true }, { queryKey: ['tasks', 'due-soon'], later: true }]);
    expect(TASK_FIGURE_VIEWS).toEqual(expect.arrayContaining(DASHBOARD_VIEWS));
    const moved = { task: t('t1'), from: { projectId: 'p1' }, to: { projectId: 'p2' } } as MoveResult;
    for (const list of [editRefreshes('t1', { title: 'x' }), createdTaskRefreshes('p1'), assignmentRefreshes('t1'), moveRefreshes('t1', 'p1'), approvalRefreshes('t1'), projectMoveRefreshes(moved)]) {
      for (const v of DASHBOARD_VIEWS) expect(list).toContainEqual(v);
    }
  });
  it('are marked out of date, not fetched at once — after an edit, a new task, a decision and a delete', () => {
    for (const change of [
      (qc: QueryClient) => refresh(qc, editRefreshes('t1', { title: 'x' })),
      (qc: QueryClient) => refresh(qc, createdTaskRefreshes('p1')),
      (qc: QueryClient) => afterApprovalDecision(qc, 't1', t('t1')),
      (qc: QueryClient) => afterTaskDeleted(qc, 't1'),
    ]) {
      const qc = seeded();
      qc.setQueryData(['dashboard', 'admin-totals'], { total: 3 });
      qc.setQueryData(['activity'], []);
      qc.setQueryData(['tasks', 'due-soon'], []);
      change(qc);
      const keys = refreshedKeys(qc);
      for (const k of ['["dashboard","admin-totals"]', '["activity"]', '["tasks","due-soon"]']) expect(keys).toContain(k);
      for (const key of [['dashboard'], ['activity'], ['tasks', 'due-soon']]) expect(qc.getQueryCache().findAll({ queryKey: key }).every((q) => q.state.fetchStatus === 'idle')).toBe(true);
    }
  });
  it('Due soon is the Dashboard’s own key (core/dashboard-queries DUE_SOON_KEY)', () =>
    expect(appSource('core/dashboard-queries.ts')).toContain("export const DUE_SOON_KEY = ['tasks', 'due-soon'] as const;"));
});
