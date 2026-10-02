import { describe, it, expect } from 'vitest';
import { composeBoard, resolveDrop, moveTaskInBoard, reorderColumnInBoard, dropIndex } from './board';
import type { ApiColumn } from '../api/columns';
import type { ApiTask } from '../api/tasks';

const columns: ApiColumn[] = [
  { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#2E7D53', enabled: true },
  { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
];

const tasks: ApiTask[] = [
  { id: 't1', key: 'MICO-1', title: 'A', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' },
  { id: 't2', key: 'MICO-2', title: 'B', description: null, projectId: 'p1', columnId: 'c2', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 100, completedAt: null, createdAt: '', updatedAt: '' },
];

describe('composeBoard', () => {
  it('orders columns by position and groups tasks into them', () => {
    const board = composeBoard(columns, tasks);
    expect(board.map((c) => c.name)).toEqual(['To Do', 'Done']);
    expect(board[0]!.tasks[0]!.key).toBe('MICO-1');
    expect(board[1]!.tasks[0]!.key).toBe('MICO-2');
  });

  it('marks tasks in a DONE column (or completed) as done, so they are never shown overdue', () => {
    const board = composeBoard(columns, tasks);
    expect(board[1]!.tasks[0]!.done).toBe(true); // MICO-2 sits in "Done"
    expect(board[0]!.tasks[0]!.done).toBe(false);
  });

  it('flags the tasks that repeat (the newest copy of a series carries the rule)', () => {
    const board = composeBoard(columns, [{ ...tasks[0]!, recurrenceRule: { freq: 'DAILY', interval: 1 } }, tasks[1]!]);
    expect(board[0]!.tasks[0]!.recurring).toBe(true);
    expect(board[1]!.tasks[0]!.recurring).toBe(false);
  });

  it('produces empty task lists for columns with no tasks', () => {
    const board = composeBoard(columns, []);
    expect(board[0]!.tasks).toHaveLength(0);
  });
});

describe('resolveDrop', () => {
  const board = composeBoard(columns, tasks); // c1 "To Do" has MICO-1, c2 "Done" has MICO-2

  it('moves a task dropped onto another column', () => {
    expect(resolveDrop('MICO-1', 'c2', board)).toEqual({ taskKey: 'MICO-1', toColumnId: 'c2' });
  });

  it('moves a task dropped onto a task in another column', () => {
    expect(resolveDrop('MICO-1', 'MICO-2', board)).toEqual({ taskKey: 'MICO-1', toColumnId: 'c2' });
  });

  it('is a no-op when dropped in the same column', () => {
    expect(resolveDrop('MICO-1', 'c1', board)).toBeNull();
  });

  it('is null for an unknown task', () => {
    expect(resolveDrop('nope', 'c2', board)).toBeNull();
  });
});

describe('moveTaskInBoard', () => {
  const board = composeBoard(columns, tasks); // c1 "To Do" has MICO-1, c2 "Done" has MICO-2

  it('moves the task out of its column and into the target', () => {
    const next = moveTaskInBoard(board, 'MICO-1', 'c2');
    const todo = next.find((c) => c.id === 'c1')!;
    const done = next.find((c) => c.id === 'c2')!;
    expect(todo.tasks.map((t) => t.key)).toEqual([]);
    expect(done.tasks.map((t) => t.key)).toEqual(['MICO-2', 'MICO-1']);
  });

  it('does not mutate the input columns', () => {
    moveTaskInBoard(board, 'MICO-1', 'c2');
    expect(board.find((c) => c.id === 'c1')!.tasks.map((t) => t.key)).toEqual(['MICO-1']);
  });

  it('returns the columns unchanged when the task is not found', () => {
    expect(moveTaskInBoard(board, 'nope', 'c2')).toBe(board);
  });

  it('inserts the task where it was dropped in the target column', () => {
    const next = moveTaskInBoard(board, 'MICO-1', 'c2', 0);
    expect(next.find((c) => c.id === 'c2')!.tasks.map((t) => t.key)).toEqual(['MICO-1', 'MICO-2']);
  });
});

describe('reorderColumnInBoard', () => {
  const cols = composeBoard(columns, [
    ...tasks,
    { id: 't3', key: 'MICO-3', title: 'C', description: null, projectId: 'p1', columnId: 'c1', position: 1, priority: 'LOW', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' },
  ]); // c1 "To Do" now has MICO-1, MICO-3

  it('reorders a column to the given key order', () => {
    const next = reorderColumnInBoard(cols, 'c1', ['MICO-3', 'MICO-1']);
    expect(next.find((c) => c.id === 'c1')!.tasks.map((t) => t.key)).toEqual(['MICO-3', 'MICO-1']);
    // other columns untouched
    expect(next.find((c) => c.id === 'c2')!.tasks.map((t) => t.key)).toEqual(['MICO-2']);
  });

  it('appends any task missing from the order (safety net)', () => {
    const next = reorderColumnInBoard(cols, 'c1', ['MICO-3']);
    expect(next.find((c) => c.id === 'c1')!.tasks.map((t) => t.key)).toEqual(['MICO-3', 'MICO-1']);
  });
});

describe('dropIndex', () => {
  const dest = { id: 'c2', name: 'Doing', color: '#000', tasks: ['A', 'B', 'C'].map((k) => ({ key: k, title: k, priority: 'NORMAL' as const, progress: 0, assignees: [] })) };

  it('lands on the slot of the card it was dropped on (before it, or after it in its lower half)', () => {
    expect(dropIndex(dest, 'B', 'X', false)).toBe(1);
    expect(dropIndex(dest, 'B', 'X', true)).toBe(2);
  });

  it('lands at the end when dropped on the column’s empty space', () => {
    expect(dropIndex(dest, 'c2', 'X', false)).toBe(3);
  });
});
