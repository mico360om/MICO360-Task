import { describe, it, expect } from 'vitest';
import { moveChangesWithExtras } from './task-move-extra';
import type { MovePreview, TaskMoveExtras, TaskMovePreview } from '../api/tasks';

// 1.24: the Move dialog's lines for categories and guests — on top of lib/task-move.ts (which the Android app
// shares byte for byte, so it stays as it is).
function task(over: Partial<TaskMovePreview & TaskMoveExtras> = {}): TaskMovePreview {
  return {
    id: 't4', key: 'RIG-4', title: 'Inspect the rig', from: { id: 'rig', code: 'RIG', name: 'Rig Inspection' }, canMove: true, reason: null,
    newKey: 'OPS-17', currentCategory: 'IN_PROGRESS', completed: false, columnId: 'o-doing', milestoneCleared: false, dueDate: null, repeat: null, outsiders: [], ...over,
  };
}
const preview = (tasks: TaskMovePreview[]): MovePreview => ({
  project: { id: 'ops', code: 'OPS', name: 'Operations', status: 'ACTIVE', color: null, icon: null, imageUrl: null, defaultDueToday: false },
  columns: [{ id: 'o-doing', name: 'Doing', category: 'IN_PROGRESS', position: 0, enabled: true }],
  tasks,
  outsiders: [],
});
const TODAY = '2026-10-24';

describe('What a move will change: categories and guests (1.24)', () => {
  it('one task: the categories it drops (the new project has none of those names) and the guests copied to the new company’s list', () => {
    expect(moveChangesWithExtras(preview([task({ categoriesDropped: ['Electrical', 'HSE'], guestsCopied: 2 })]), TODAY)).toEqual([
      'Becomes OPS-17. Searching for RIG-4 still finds it.',
      'Drops categories: Electrical, HSE — Operations has none of those names.',
      'Copies 2 guests to the new company’s list.',
      'Its comments, files, checklist, history, watchers and blockers go with it.',
    ]);
    expect(moveChangesWithExtras(preview([task({ categoriesDropped: ['Civil'], guestsCopied: 1 })]), TODAY)).toEqual([
      'Becomes OPS-17. Searching for RIG-4 still finds it.',
      'Drops category: Civil — Operations has none of that name.',
      'Copies 1 guest to the new company’s list.',
      'Its comments, files, checklist, history, watchers and blockers go with it.',
    ]);
    // Nothing dropped or copied (or an older server): no lines.
    expect(moveChangesWithExtras(preview([task({ categoriesDropped: [], guestsCopied: 0 })]), TODAY)).toHaveLength(2);
    expect(moveChangesWithExtras(preview([task({ canMove: false, reason: 'x', newKey: null })]), TODAY)).toEqual([]);
  });

  it('several tasks: each one that drops categories or copies guests, by its number', () => {
    const many = [
      task({ id: 'a', key: 'RIG-1', newKey: 'OPS-17', categoriesDropped: ['Electrical', 'HSE'] }),
      task({ id: 'b', key: 'RIG-2', newKey: 'OPS-18', guestsCopied: 1 }),
      task({ id: 'c', key: 'RIG-3', newKey: 'OPS-19', categoriesDropped: ['Civil'], guestsCopied: 3 }),
      task({ id: 'd', key: 'RIG-4', newKey: 'OPS-20' }),
      task({ id: 'e', key: 'ADM-1', canMove: false, newKey: null, reason: 'Already in Operations.', categoriesDropped: ['X'] }),
    ];
    expect(moveChangesWithExtras(preview(many), TODAY)).toEqual([
      'They get the next OPS numbers, OPS-17 to OPS-20. Searching for their old numbers still finds them.',
      'RIG-1 drops categories: Electrical, HSE.',
      'RIG-2 copies 1 guest to the new company’s list.',
      'RIG-3 drops category: Civil, and copies 3 guests to the new company’s list.',
      'Their comments, files, checklists, history, watchers and blockers go with them.',
    ]);
  });
});
