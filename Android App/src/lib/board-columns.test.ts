import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { COLUMN_COLORS, COLUMN_TEXT, columnActionError, columnNameProblem, columnOrderSteps, columnSwapSteps, orderedColumns } from './board-columns';
import type { ApiColumn } from './types';

const col = (id: string, position: number, patch: Partial<ApiColumn> = {}): ApiColumn => ({ id, projectId: 'p1', name: id, category: 'TODO', position, color: '#1E5A8B', enabled: true, ...patch });

describe('Manage columns (4b), as on the website', () => {
  it('lists every column in board order, the hidden ones too', () => {
    expect(orderedColumns([col('b', 2), col('a', 0, { enabled: false }), col('c', 1)]).map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('a new or renamed column needs a name (the website’s words)', () => {
    expect(columnNameProblem('  ')).toBe('Column name is required.');
    expect(columnNameProblem(' In Review ')).toBeNull();
    expect(COLUMN_TEXT.addNote).toBe('New columns start as a “To do” stage — set its mapped status after adding.');
  });

  it('moves a column up or down by swapping it with its neighbour through a free place (the server keeps places unique)', () => {
    const cols = [col('a', 0), col('b', 1), col('c', 5)];
    expect(columnSwapSteps(cols, 'c', 'up')).toEqual([
      { id: 'c', position: -6 },
      { id: 'b', position: 5 },
      { id: 'c', position: 1 },
    ]);
    expect(columnSwapSteps(cols, 'a', 'up')).toEqual([]);
    expect(columnSwapSteps(cols, 'c', 'down')).toEqual([]);
  });

  it('a whole new order goes in two passes (out of the way, then into place), as the website’s drag does', () => {
    expect(columnOrderSteps(['b', 'a'])).toEqual([
      { id: 'b', position: -1000 },
      { id: 'a', position: -1001 },
      { id: 'b', position: 0 },
      { id: 'a', position: 1 },
    ]);
  });

  it('says why a change didn’t happen: the server’s words (a column that still has tasks), or the website’s connection message', () => {
    expect(columnActionError(new ApiError(409, 'COLUMN_NOT_EMPTY', 'This column still has 2 tasks. Move them to another column first.'))).toBe(
      'This column still has 2 tasks. Move them to another column first.',
    );
    expect(columnActionError(new ApiError(403, 'FORBIDDEN', 'Forbidden'))).toBe('Only an administrator or a manager of this project can change its columns.');
    expect(columnActionError(new NetworkError('offline'))).toBe('Couldn’t save that column change. Check your connection and try again.');
    expect(columnActionError(new Error('x'))).toBe('Couldn’t save that column change. Check your connection and try again.');
  });

  it('offers colours to choose from, each with a name', () => {
    expect(COLUMN_COLORS.length).toBeGreaterThanOrEqual(10);
    for (const c of COLUMN_COLORS) expect(c.name).toBeTruthy();
  });
});
