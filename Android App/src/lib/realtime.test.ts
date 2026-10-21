import { describe, it, expect } from 'vitest';
import { applyTaskEvent, taskEventRefreshes, boardRefreshes, taskPartRefreshes, TASK_EVENTS, TASK_PART_EVENTS, PROJECT_REMOVED_EVENT, isProjectRemoval } from './realtime';
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

describe('applyTaskEvent (A2 realtime)', () => {
  it('appends a created task', () => {
    const next = applyTaskEvent([t('a')], { type: 'task:created', payload: t('b') });
    expect(next.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('upserts (never duplicates) a created task already present', () => {
    const next = applyTaskEvent([t('a')], { type: 'task:created', payload: t('a', { title: 'renamed' }) });
    expect(next).toHaveLength(1);
    expect(next[0]!.title).toBe('renamed');
  });

  it('replaces an updated task in place', () => {
    const next = applyTaskEvent([t('a'), t('b')], { type: 'task:updated', payload: t('b', { title: 'edited' }) });
    expect(next.map((x) => x.title)).toEqual(['a', 'edited']);
  });

  it('applies a move (column + position) in place', () => {
    const next = applyTaskEvent([t('a', { columnId: 'c1' })], {
      type: 'task:moved',
      payload: t('a', { columnId: 'c2', position: 5 }),
    });
    expect(next[0]!.columnId).toBe('c2');
    expect(next[0]!.position).toBe(5);
  });

  it('removes a deleted task', () => {
    const next = applyTaskEvent([t('a'), t('b')], { type: 'task:deleted', payload: { id: 'a' } });
    expect(next.map((x) => x.id)).toEqual(['b']);
  });

  it('returns the same reference for an unrelated event', () => {
    const list = [t('a')];
    const next = applyTaskEvent(list, { type: 'noise' as never, payload: {} as never });
    expect(next).toBe(list);
  });
});

describe('taskEventRefreshes (MOB-04, precise since 1c)', () => {
  const exact = (...queryKey: string[]) => ({ queryKey, exact: true });
  const board = [{ queryKey: ['tasks', 'project', 'p1'] }, exact('project', 'p1', 'progress')];

  // A meeting's action item follows its task into Done and out of it (and loses its task when it's deleted).
  const myItems = { queryKey: ['action-items', 'mine'] };

  it('a change to a task: its project’s board days and progress, the lists holding it, the task, its activity and My Action Items', () => {
    for (const ev of ['task:updated', 'task:moved']) {
      expect(taskEventRefreshes(ev, 'p1', { id: 't9' })).toEqual([...board, { listsHolding: 't9' }, exact('task', 't9'), exact('task', 't9', 'activity'), myItems]);
    }
  });

  it('never the task’s other parts (they have their own events)', () => {
    expect(taskEventRefreshes('task:updated', 'p1', { id: 't9' })).not.toContainEqual({ queryKey: ['task', 't9'] });
  });

  it('a new task may be yours: My tasks too (but it has no action item yet)', () => {
    expect(taskEventRefreshes('task:created', 'p1', { id: 't9' })).toContainEqual({ queryKey: ['tasks', 'mine'] });
    expect(taskEventRefreshes('task:created', 'p1', { id: 't9' })).not.toContainEqual(myItems);
    expect(taskEventRefreshes('task:updated', 'p1', { id: 't9' })).not.toContainEqual({ queryKey: ['tasks', 'mine'] });
  });

  it('a deleted task: the lists holding it, its details (which then say it’s gone) and My Action Items', () => {
    expect(taskEventRefreshes('task:deleted', 'p1', { id: 't9' })).toEqual([...board, { listsHolding: 't9' }, exact('task', 't9'), myItems]);
  });

  it('without a task id: the board, My tasks, progress and My Action Items', () => {
    expect(taskEventRefreshes('task:updated', 'p1', {})).toEqual([...board, { queryKey: ['tasks', 'mine'] }, myItems]);
    expect(taskEventRefreshes('task:moved', 'p1', null)).toEqual([...board, { queryKey: ['tasks', 'mine'] }, myItems]);
  });

  it('after a reconnect: the board, its columns, My tasks, progress and My Action Items', () => {
    expect(boardRefreshes('p1')).toEqual([...board, { queryKey: ['tasks', 'mine'] }, { queryKey: ['columns', 'p1'] }, myItems]);
  });

  it('listens to create / update / move / delete', () => {
    expect([...TASK_EVENTS]).toEqual(['task:created', 'task:updated', 'task:moved', 'task:deleted']);
  });
});

describe('project:removed', () => {
  it('matches only a removal from this project', () => {
    expect(PROJECT_REMOVED_EVENT).toBe('project:removed');
    expect(isProjectRemoval({ projectId: 'p1' }, 'p1')).toBe(true);
    expect(isProjectRemoval({ projectId: 'p2' }, 'p1')).toBe(false);
    expect(isProjectRemoval(undefined, 'p1')).toBe(false);
    expect(isProjectRemoval({ projectId: 'p1' }, '')).toBe(false);
  });
});

describe('task part events — assignees, tags, watchers, checklist and comments', () => {
  it('are the events the board now listens to as well', () => {
    expect([...TASK_PART_EVENTS]).toEqual([
      'task:assignees',
      'task:tagged',
      'task:watchers',
      'checklist:changed',
      'comment:created',
      'comment:updated',
      'comment:deleted',
    ]);
  });

  it('refresh only the part of that task that changed (never the whole task or the board)', () => {
    const exact = (...queryKey: string[]) => ({ queryKey, exact: true });
    expect(taskPartRefreshes('task:tagged', { taskId: 't1', tags: [] })).toEqual([exact('task', 't1', 'tags')]);
    expect(taskPartRefreshes('task:watchers', { taskId: 't1', watchers: [] })).toEqual([exact('task', 't1', 'watchers'), exact('task', 't1', 'watch')]);
    // The task's progress follows its checklist.
    expect(taskPartRefreshes('checklist:changed', { taskId: 't1' })).toEqual([
      exact('task', 't1', 'checklist'),
      exact('task', 't1'),
      exact('task', 't1', 'activity'),
    ]);
    expect(taskPartRefreshes('comment:created', { taskId: 't1', comment: {} })).toEqual([exact('task', 't1', 'comments'), exact('task', 't1', 'activity')]);
    expect(taskPartRefreshes('comment:updated', { taskId: 't1', comment: {} })).toEqual([exact('task', 't1', 'comments')]);
    expect(taskPartRefreshes('comment:deleted', { taskId: 't1', id: 'c1' })).toEqual([exact('task', 't1', 'comments')]);
  });

  it('new assignees refresh the task’s people and history; My tasks only when I joined or left', () => {
    const people = [
      { queryKey: ['task', 't1', 'assignees'], exact: true },
      { queryKey: ['task', 't1', 'activity'], exact: true },
    ];
    const assignees = [{ id: 'me' }, { id: 'u2' }];
    // I was just assigned: the task isn't in My tasks yet.
    expect(taskPartRefreshes('task:assignees', { taskId: 't1', assignees }, { myId: 'me', inMyTasks: false })).toEqual([
      ...people,
      { queryKey: ['tasks', 'mine'] },
    ]);
    // I was taken off: it still is.
    expect(taskPartRefreshes('task:assignees', { taskId: 't1', assignees: [{ id: 'u2' }] }, { myId: 'me', inMyTasks: true })).toEqual([
      ...people,
      { queryKey: ['tasks', 'mine'] },
    ]);
    // Someone else changed: My tasks stays as it is.
    expect(taskPartRefreshes('task:assignees', { taskId: 't1', assignees }, { myId: 'me', inMyTasks: true })).toEqual(people);
    expect(taskPartRefreshes('task:assignees', { taskId: 't1', assignees: [{ id: 'u2' }] }, { myId: 'me', inMyTasks: false })).toEqual(people);
  });

  it('nothing for a payload without a task id, or an unknown event', () => {
    expect(taskPartRefreshes('task:tagged', {})).toEqual([]);
    expect(taskPartRefreshes('task:tagged', null)).toEqual([]);
    expect(taskPartRefreshes('noise', { taskId: 't1' })).toEqual([]);
  });
});
