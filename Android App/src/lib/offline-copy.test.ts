import { describe, it, expect } from 'vitest';
import { BOARD_DAYS_KEPT, isBoardDayCopy, projectTasksCopyKey, withoutOldDone } from './offline-copy';
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

describe('offline copy names', () => {
  it('names a project’s board day, or all of its tasks', () => {
    expect(projectTasksCopyKey('p1', '2026-10-21')).toBe('tasks.p1.2026-10-21');
    expect(projectTasksCopyKey('p1')).toBe('tasks.p1.all');
  });

  it('tells a board day from the other copies', () => {
    expect(isBoardDayCopy('tasks.p1.2026-10-21')).toBe(true);
    expect(isBoardDayCopy('tasks.p1.all')).toBe(false);
    expect(isBoardDayCopy('tasks.mine')).toBe(false);
    expect(isBoardDayCopy('columns.p1')).toBe(false);
  });

  it('keeps two weeks of board days', () => {
    expect(BOARD_DAYS_KEPT).toBe(14);
  });
});

describe('withoutOldDone (a slimmer copy of a long task list)', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');

  it('leaves out tasks finished more than 30 days ago, keeping every open one', () => {
    const tasks = [
      t('open'),
      t('done-last-week', { completedAt: '2026-10-14T09:00:00Z' }),
      t('done-in-august', { completedAt: '2026-08-01T09:00:00Z' }),
      t('done-column-no-date', { columnCategory: 'DONE' }),
    ];
    expect(withoutOldDone(now)(tasks).map((x) => x.id)).toEqual(['open', 'done-last-week', 'done-column-no-date']);
  });
});
