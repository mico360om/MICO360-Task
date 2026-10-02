import { describe, it, expect } from 'vitest';
import { moveTargets } from './board-move';
import type { ApiColumn } from './types';

const col = (id: string, position: number, enabled = true): ApiColumn => ({ id, projectId: 'p', name: id, category: 'TODO', position, color: '#000', enabled });

describe('moveTargets', () => {
  it('lists the other enabled columns in board order', () => {
    const cols = [col('done', 4), col('todo', 1), col('backlog', 0), col('hidden', 2, false), col('review', 3)];
    expect(moveTargets(cols, 'todo').map((c) => c.id)).toEqual(['backlog', 'review', 'done']);
  });
});
