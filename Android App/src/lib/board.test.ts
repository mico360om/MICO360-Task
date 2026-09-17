import { describe, it, expect } from 'vitest';
import { composeBoard } from './board';
import type { ApiColumn, ApiTask } from './types';

const col = (id: string, position: number, enabled = true): ApiColumn => ({
  id,
  projectId: 'p1',
  name: id,
  category: 'TODO',
  position,
  color: '#8B1E1E',
  enabled,
});

const task = (id: string, columnId: string, position: number): ApiTask => ({
  id,
  key: `T-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId,
  position,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
});

describe('composeBoard', () => {
  it('orders columns by position and nests each column its own tasks in order', () => {
    const columns = [col('b', 1), col('a', 0)];
    const tasks = [task('t2', 'a', 1), task('t1', 'a', 0), task('t3', 'b', 0)];
    const board = composeBoard(columns, tasks);
    expect(board.map((b) => b.column.id)).toEqual(['a', 'b']);
    expect(board[0]!.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(board[1]!.tasks.map((t) => t.id)).toEqual(['t3']);
  });

  it('excludes disabled columns', () => {
    const board = composeBoard([col('a', 0), col('hidden', 1, false)], [task('t1', 'hidden', 0)]);
    expect(board.map((b) => b.column.id)).toEqual(['a']);
  });

  it('returns empty task lists for columns with no tasks', () => {
    const board = composeBoard([col('a', 0)], []);
    expect(board).toEqual([{ column: col('a', 0), tasks: [] }]);
  });
});
