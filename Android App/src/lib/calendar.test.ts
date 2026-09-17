import { describe, it, expect } from 'vitest';
import { groupTasksByDueDate } from './calendar';
import type { ApiTask } from './types';

const t = (id: string, dueDate: string | null): ApiTask => ({
  id,
  key: `T-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
});

describe('groupTasksByDueDate', () => {
  it('groups tasks under their local due day, sorted by day ascending', () => {
    const groups = groupTasksByDueDate([
      t('b', '2026-09-10T15:00:00'),
      t('a', '2026-09-08T09:00:00'),
      t('c', '2026-09-10T08:00:00'),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-09-08', '2026-09-10']);
    expect(groups[1]!.tasks.map((x) => x.id)).toEqual(['c', 'b']); // within a day, earliest time first
  });

  it('omits tasks with no due date', () => {
    const groups = groupTasksByDueDate([t('a', null), t('b', '2026-09-08T09:00:00')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tasks.map((x) => x.id)).toEqual(['b']);
  });

  it('returns an empty array when nothing is scheduled', () => {
    expect(groupTasksByDueDate([t('a', null)])).toEqual([]);
  });
});
