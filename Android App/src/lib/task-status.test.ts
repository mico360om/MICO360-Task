import { describe, it, expect } from 'vitest';
import { statusOf, refetchAfterMove } from './task-status';
import { ApiError, NetworkError } from './api-client';
import type { ApiColumn } from './types';

const col = (id: string, name: string, category: ApiColumn['category'], enabled = true): ApiColumn => ({ id, projectId: 'p1', name, category, position: 0, color: '#000', enabled });

describe('statusOf — a task always shows its status', () => {
  it('finds the task’s column, even a hidden one', () => {
    const cols = [col('c1', 'To Do', 'TODO'), col('c9', 'Parked', 'BLOCKED', false)];
    expect(statusOf({ columnId: 'c9' }, cols)).toEqual({ name: 'Parked', category: 'BLOCKED' });
  });
  it('falls back to the task’s own column category when the column isn’t known', () => {
    expect(statusOf({ columnId: 'gone', columnCategory: 'DONE' }, [col('c1', 'To Do', 'TODO')])).toEqual({ name: 'Done', category: 'DONE' });
  });
  it('null when nothing is known', () => {
    expect(statusOf({ columnId: 'gone' }, [])).toBeNull();
  });
});

describe('refetchAfterMove — an offline move stays where it was put', () => {
  it('no refetch after a network error (the move is queued; the cache would put the card back)', () => {
    expect(refetchAfterMove(new NetworkError('offline'))).toBe(false);
  });
  it('a refetch after success or a server refusal', () => {
    expect(refetchAfterMove(null)).toBe(true);
    expect(refetchAfterMove(new ApiError(409, 'X', 'no'))).toBe(true);
  });
});
