import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskChip, STATUS_META } from './calendar-ui';
import type { CalItem } from '../../lib/calendar-model';
import type { ApiTask } from '../../api/tasks';

const task = (extra: Partial<ApiTask> = {}): ApiTask =>
  ({ id: 't1', key: 'MICO-7', title: 'Pour the level 5 slab', description: null, projectId: 'p1', columnId: 'c', position: 0, priority: 'NORMAL', startDate: null, dueDate: '2026-11-10', progress: 0, completedAt: null, createdAt: '', updatedAt: '', columnCategory: 'IN_PROGRESS', ...extra }) as ApiTask;
const item = (status: CalItem['status'], extra: Partial<ApiTask> = {}): CalItem => ({ key: 't1', kind: 'task', task: task(extra), date: '2026-11-10', status, projectArchived: false, recurring: false });

describe('calendar chips in the one colour scheme (1.23.8)', () => {
  it('keep their project’s colour on the edge and gain a dot in their status’s colour', () => {
    render(<TaskChip item={item('in-progress')} color="#1E5A8B" draggable={false} onOpen={() => {}} />);
    const chip = screen.getByRole('button', { name: /MICO-7/ });
    expect(chip.className).toContain('border-s-[3px]'); // the project's colour goes on this edge (jsdom drops the logical style)
    expect(chip.querySelector('[data-status-dot]')).toHaveClass('bg-status-progress');
  });

  it('the dot follows the column kind: Review purple, Blocked red, To do slate, Done green', () => {
    const { rerender } = render(<TaskChip item={item('in-progress', { columnCategory: 'REVIEW' })} draggable={false} onOpen={() => {}} />);
    const dot = () => screen.getByRole('button', { name: /MICO-7/ }).querySelector('[data-status-dot]');
    expect(dot()).toHaveClass('bg-status-review');
    rerender(<TaskChip item={item('blocked', { columnCategory: 'BLOCKED' })} draggable={false} onOpen={() => {}} />);
    expect(dot()).toHaveClass('bg-status-blocked');
    rerender(<TaskChip item={item('todo', { columnCategory: 'TODO' })} draggable={false} onOpen={() => {}} />);
    expect(dot()).toHaveClass('bg-status-todo');
    rerender(<TaskChip item={item('done', { columnCategory: 'DONE' })} draggable={false} onOpen={() => {}} />);
    expect(dot()).toHaveClass('bg-status-done');
  });

  it('an overdue chip: red words and edges (the project edge stays); never colour alone (its icon and name say it)', () => {
    render(<TaskChip item={item('overdue', { columnCategory: 'TODO' })} color="#1E5A8B" draggable={false} onOpen={() => {}} />);
    const chip = screen.getByRole('button', { name: /MICO-7.*overdue/ });
    expect(chip.className).toContain('text-overdue');
    expect(chip.className).toContain('border-overdue');
    expect(chip.className).toContain('border-s-[3px]'); // the project's colour goes on this edge (jsdom drops the logical style)
  });

  it('the legend’s marks come from the scheme too (no general danger / warning / info tones)', () => {
    for (const s of Object.values(STATUS_META)) expect(`${s.chip} ${s.dot}`).not.toMatch(/(?:danger|warning|info|success)\b/);
    expect(STATUS_META.overdue.chip).toContain('text-overdue');
    expect(STATUS_META.blocked.dot).toBe('bg-status-blocked');
    expect(STATUS_META['in-progress'].dot).toBe('bg-status-progress');
    expect(STATUS_META.done.dot).toBe('bg-status-done');
  });
});
