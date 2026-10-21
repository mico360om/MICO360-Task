import { describe, it, expect } from 'vitest';
import { allBoardEventRefreshes, allBoardRefreshes, columnChangedRefreshes, applyTaskEvent, taskEventRefreshes, boardRefreshes, taskPartRefreshes, TASK_EVENTS, TASK_PART_EVENTS, PROJECT_REMOVED_EVENT, isProjectRemoval, createJoinMemory, afterRemoval } from './realtime';
import { ApiError, NetworkError } from './api-client';
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
  const myItems = { queryKey: ['action-items', 'mine'], later: true };

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

describe('back on a project after looking at something over it (5b review #5)', () => {
  it('the first connection on return refreshes the board, as a reconnect does — not the very first one', () => {
    const joins = createJoinMemory();
    expect(joins.returning('p1')).toBe(false); // first time: the screen has just loaded it
    expect(joins.returning('p1')).toBe(true); // back from a task opened over it
    expect(joins.returning('p2')).toBe(false);
    expect(joins.returning('p1')).toBe(true);
  });
});

describe('"you were removed from this project" (5b review #6)', () => {
  it('leaves only when the project can no longer be opened; someone who still sees it (an administrator) stays and listens again', async () => {
    const gone = () => Promise.reject(new ApiError(404, 'NOT_FOUND', 'Project not found.'));
    const refused = () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'You do not have access to this project.'));
    expect(await afterRemoval(gone)).toBe('gone');
    expect(await afterRemoval(refused)).toBe('gone');
    expect(await afterRemoval(async () => ({ id: 'p1' }))).toBe('still-allowed');
    // Offline: can't tell — the screen stays on what it has (it hears no more of the project).
    expect(await afterRemoval(() => Promise.reject(new NetworkError('offline')))).toBe('unknown');
  });
});

describe('the live board hook (5b review #5, #6)', () => {
  it('refreshes on the first connection back, and checks the project before leaving it on a removal', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const hook = readFileSync(resolve(__dirname, '../core/useBoardRealtime.ts'), 'utf8');
    expect(hook).toMatch(/if \(isReconnect \|\| back\) later\(boardRefreshes\(projectId\)\);/);
    expect(hook).toMatch(/afterRemoval\(\(\) => services\.resources\.projects\.get\(projectId\)\)/);
    expect(hook).toMatch(/if \(outcome === 'gone'\) onRemovedRef\.current\?\.\(\);/);
  });
});

describe('the All projects board, live (4c): one connection for every project it shows', () => {
  const exact = (...queryKey: string[]) => ({ queryKey, exact: true });
  const myItems = { queryKey: ['action-items', 'mine'], later: true };
  const all = { queryKey: ['tasks', 'all'] };

  it('a change to a task refreshes the board (the day on screen) and what the project’s own board would', () => {
    expect(allBoardEventRefreshes('task:moved', { id: 't9', projectId: 'p2' })).toEqual([all, ...taskEventRefreshes('task:moved', 'p2', { id: 't9', projectId: 'p2' })]);
  });

  it('a deleted task (no project named): the board, the lists holding it, its details and My Action Items', () => {
    expect(allBoardEventRefreshes('task:deleted', { id: 't9' })).toEqual([all, { listsHolding: 't9' }, exact('task', 't9'), myItems]);
  });

  it('a new task may be yours: My tasks too', () => {
    expect(allBoardEventRefreshes('task:created', { id: 't9', projectId: 'p1' })).toContainEqual({ queryKey: ['tasks', 'mine'] });
  });

  it('after a reconnect (events may have been missed): the board, My tasks, the columns when next used and My Action Items', () => {
    expect(allBoardRefreshes()).toEqual([all, { queryKey: ['tasks', 'mine'] }, { queryKey: ['columns'], later: true }, myItems]);
  });

  it('a project’s columns changed: its columns, and the board (a column switched off takes its cards off)', () => {
    expect(columnChangedRefreshes({ projectId: 'p2', action: 'updated' })).toEqual([{ queryKey: ['columns', 'p2'] }, all]);
    expect(columnChangedRefreshes(null)).toEqual([{ queryKey: ['columns'] }, all]);
  });
});
