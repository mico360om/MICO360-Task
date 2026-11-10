import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TasksTab } from './TasksTab';
import type { ApiTask } from '../../api/tasks';
import { taskPhase, taskStats, workload } from '../../lib/project-dashboard';

// Tasks scheduled for the future (owner, 10 Nov 2026): in the project's list a task waiting for its start
// day is under "Upcoming" — not Pending (not started) — until that day.

const TODAY = '2026-11-10';
const task = (key: string, title: string, o: Partial<ApiTask> = {}): ApiTask => ({
  id: key, key, title, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '',
  boardDate: `${TODAY}T12:00:00.000Z`, assignees: [{ id: 'u1', name: 'Sara Ali' }], ...o,
} as ApiTask);
const waiting = task('MICO-3', 'Pour the slab', { startDate: '2026-11-20T00:00:00.000Z', dueDate: '2026-11-22T00:00:00.000Z', boardDate: '2026-11-20T12:00:00.000Z' });
const sooner = task('MICO-4', 'Set out the site', { startDate: '2026-11-14T00:00:00.000Z', boardDate: '2026-11-14T12:00:00.000Z' });
const groups = [
  { id: 'c1', name: 'To Do', color: '#3A6EA5', tasks: [task('MICO-1', 'Check the drawings'), waiting, sooner] },
  { id: 'c2', name: 'Doing', color: '#2563eb', tasks: [task('MICO-2', 'Order steel', { columnId: 'c2', columnCategory: 'IN_PROGRESS' })] },
];

describe('the project’s numbers', () => {
  it('a waiting task is “upcoming”, not pending; on its start day it is pending again', () => {
    expect(taskPhase(waiting, TODAY, 'Asia/Muscat')).toBe('upcoming');
    expect(taskPhase(waiting, '2026-11-20', 'Asia/Muscat')).toBe('pending');
    expect(taskPhase({ ...waiting, completedAt: '2026-11-09T08:00:00.000Z', columnCategory: 'DONE' }, TODAY, 'Asia/Muscat')).toBe('completed');
    const stats = taskStats(groups.flatMap((g) => g.tasks), TODAY, 'Asia/Muscat');
    expect(stats).toMatchObject({ total: 4, pending: 1, ongoing: 1, upcoming: 2, completed: 0, overdue: 0 });
  });

  it('a person’s open load on the project leaves out their waiting tasks', () => {
    expect(workload(groups.flatMap((g) => g.tasks), TODAY, 'Asia/Muscat')).toEqual([{ id: 'u1', name: 'Sara Ali', open: 2, overdue: 0, completed: 0 }]);
  });
});

describe('the project’s Tasks tab', () => {
  const show = (filter: Parameters<typeof TasksTab>[0]['filter']) =>
    render(<TasksTab groups={groups} today={TODAY} timeZone="Asia/Muscat" loading={false} filter={filter} onFilter={vi.fn()} onOpen={vi.fn()} />);

  it('lists waiting tasks under “Upcoming” after the columns, soonest start first, each saying when it starts', () => {
    show('all');
    const upcoming = screen.getByRole('region', { name: 'Upcoming, 2' });
    const rows = within(upcoming).getAllByRole('button');
    expect(rows.map((r) => within(r).getByText(/Pour the slab|Set out the site/).textContent)).toEqual(['Set out the site', 'Pour the slab']);
    expect(within(upcoming).getByText('Starts 14 Nov')).toBeInTheDocument();
    const todo = screen.getByRole('region', { name: 'To Do, 1' });
    expect(within(todo).queryByText('Pour the slab')).toBeNull();
  });

  it('an Upcoming chip with its count; Pending counts only today’s not-started tasks', () => {
    show('all');
    expect(screen.getByRole('button', { name: /^Upcoming\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Pending\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All\s*4$/ })).toBeInTheDocument();
  });

  it('the Upcoming filter shows only them; Pending none of them', () => {
    const { unmount } = show('upcoming');
    expect(screen.getByText('Pour the slab')).toBeInTheDocument();
    expect(screen.queryByText('Check the drawings')).toBeNull();
    unmount();
    show('pending');
    expect(screen.getByText('Check the drawings')).toBeInTheDocument();
    expect(screen.queryByText('Pour the slab')).toBeNull();
  });
});
