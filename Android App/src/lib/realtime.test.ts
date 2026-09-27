import { describe, it, expect } from 'vitest';
import { applyTaskEvent, taskEventInvalidationKeys, TASK_EVENTS, PROJECT_REMOVED_EVENT, isProjectRemoval } from './realtime';
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

describe('taskEventInvalidationKeys (MOB-04)', () => {
  it('refreshes every board date of the project, the task detail, My tasks and progress', () => {
    expect(taskEventInvalidationKeys('p1', { id: 't9' })).toEqual([
      ['tasks', 'project', 'p1'],
      ['tasks', 'mine'],
      ['project', 'p1', 'progress'],
      ['task', 't9'],
    ]);
  });

  it('skips the task key when the payload has no id', () => {
    expect(taskEventInvalidationKeys('p1', {})).toHaveLength(3);
    expect(taskEventInvalidationKeys('p1', null)).toHaveLength(3);
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
