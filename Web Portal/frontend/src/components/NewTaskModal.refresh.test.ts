import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { refreshTaskLists } from './NewTaskModal';

describe('a new task refreshes the task lists (the top bar button has no page of its own to tell)', () => {
  it('marks My Tasks, task lists, boards, calendar and dashboard stale, and leaves others alone', () => {
    const qc = new QueryClient();
    const keys = [['my-tasks'], ['project-tasks', 'p1'], ['tasks', 'p1'], ['board', 'p1'], ['calendar', '2026-11'], ['dashboard'], ['projects'], ['config']];
    for (const k of keys) qc.setQueryData(k, 1);
    refreshTaskLists(qc);
    const stale = (k: unknown[]) => qc.getQueryState(k)?.isInvalidated;
    expect(['my-tasks', 'project-tasks', 'tasks', 'board', 'calendar', 'dashboard'].map((k) => stale(keys.find((x) => x[0] === k)!))).toEqual([true, true, true, true, true, true]);
    expect(stale(['projects'])).toBe(false);
    expect(stale(['config'])).toBe(false);
  });
});
