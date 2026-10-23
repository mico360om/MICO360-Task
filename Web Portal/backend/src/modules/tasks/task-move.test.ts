import { describe, it, expect } from 'vitest';
import { matchingColumn, notOnTeamMessage } from './task-move';

const col = (id: string, category: string, position: number, enabled = true) => ({ id, name: id, category, position, enabled });

describe('The column a moved task goes to', () => {
  it('is the new project’s first column of the same kind, in board order', () => {
    const columns = [col('late-doing', 'IN_PROGRESS', 5), col('todo', 'TODO', 0), col('doing', 'IN_PROGRESS', 2)];
    expect(matchingColumn(columns, 'IN_PROGRESS')?.id).toBe('doing');
  });

  it('is its first column when it has none of that kind (or the task has no stage)', () => {
    const columns = [col('b', 'TODO', 1), col('a', 'BACKLOG', 0)];
    expect(matchingColumn(columns, 'REVIEW')?.id).toBe('a');
    expect(matchingColumn(columns, null)?.id).toBe('a');
  });

  it('skips columns switched off in Manage columns, unless the project has no other', () => {
    expect(matchingColumn([col('off', 'REVIEW', 0, false), col('on', 'TODO', 1)], 'REVIEW')?.id).toBe('on');
    expect(matchingColumn([col('off-todo', 'TODO', 0, false), col('off-review', 'REVIEW', 1, false)], 'REVIEW')?.id).toBe('off-review');
  });

  it('is none when the project has no columns at all', () => {
    expect(matchingColumn([], 'TODO')).toBeNull();
  });
});

describe('People assigned who aren’t on the new team', () => {
  it('are named, and asked about', () => {
    const p = (name: string) => ({ id: name, name });
    expect(notOnTeamMessage([p('Sara Al Balushi')], 'Operations')).toBe('Sara Al Balushi isn’t on the Operations team. Choose whether to add them to the team or unassign them.');
    expect(notOnTeamMessage([p('Sara'), p('Zaid')], 'Operations')).toBe('Sara and Zaid aren’t on the Operations team. Choose whether to add them to the team or unassign them.');
    expect(notOnTeamMessage([p('A'), p('B'), p('C')], 'Ops')).toBe('A, B and C aren’t on the Ops team. Choose whether to add them to the team or unassign them.');
  });
});
