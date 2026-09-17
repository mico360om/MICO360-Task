import { describe, it, expect } from 'vitest';
import { applyTaskEvent } from './realtime';
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
