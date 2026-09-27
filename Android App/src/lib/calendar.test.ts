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
  it('groups tasks under their due day, sorted by day ascending', () => {
    const groups = groupTasksByDueDate([
      t('b', '2026-09-10T00:00:00.000Z'),
      t('a', '2026-09-08T00:00:00.000Z'),
      t('c', '2026-09-10T00:00:00.000Z'),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-09-08', '2026-09-10']);
    expect(groups[1]!.tasks.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('keeps a UTC-midnight due date on its own calendar day (XP-03)', () => {
    // Stored as UTC midnight; on a phone west of UTC `new Date(...).getDate()` would say the 29th.
    const groups = groupTasksByDueDate([t('a', '2026-09-30T00:00:00.000Z')]);
    expect(groups[0]!.date).toBe('2026-09-30');
  });

  it('omits tasks with no due date', () => {
    const groups = groupTasksByDueDate([t('a', null), t('b', '2026-09-08T00:00:00.000Z')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tasks.map((x) => x.id)).toEqual(['b']);
  });

  it('returns an empty array when nothing is scheduled', () => {
    expect(groupTasksByDueDate([t('a', null)])).toEqual([]);
  });
});
