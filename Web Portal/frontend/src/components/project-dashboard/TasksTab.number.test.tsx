import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksTab } from './TasksTab';
import type { ApiTask } from '../../api/tasks';

const task = (key: string, title: string): ApiTask => ({
  id: key, key, title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '',
});
const groups = [{ id: 'c1', name: 'To Do', color: '#3A6EA5', tasks: [task('MICO-142', 'Valve check'), task('MICO-1420', 'Pump overhaul'), task('MICO-7', 'Gate repair')] }];

describe('project Tasks tab: the task number (1.22.3)', () => {
  it('a long number (MICO360-10) stays whole on one line and the title takes the room left', () => {
    const long = [{ id: 'c1', name: 'To Do', color: '#3A6EA5', tasks: [task('MICO360-10', 'A long title that has to give way to the number'), task('MICO360-11', 'Another')] }];
    render(<TasksTab groups={long} today="2026-10-31" timeZone="Asia/Muscat" loading={false} filter="all" onFilter={vi.fn()} onOpen={vi.fn()} />);
    for (const key of ['MICO360-10', 'MICO360-11']) {
      const chip = screen.getByText(key);
      expect(chip).toHaveAttribute('data-task-key', key);
      expect(chip).toHaveClass('whitespace-nowrap', 'shrink-0');
      // Its old fixed 4rem box broke "MICO360-" from "10"; nothing around it may squeeze it now.
      for (let el: HTMLElement | null = chip; el && el.tagName !== 'BUTTON'; el = el.parentElement) expect(el.className).not.toMatch(/(^|\s)w-16(\s|$)/);
    }
    const title = screen.getByText('A long title that has to give way to the number');
    expect(title).toHaveClass('truncate');
  });
});

describe('project Tasks tab: finding a task by its number (1.22.3)', () => {
  it('“Find a task…” matches the number however it is typed — exactly that number', async () => {
    for (const typed of ['mico142', 'MICO 142', 'mico_142', '#MICO-142']) {
      const { unmount } = render(<TasksTab groups={groups} today="2026-10-31" timeZone="Asia/Muscat" loading={false} filter="all" onFilter={vi.fn()} onOpen={vi.fn()} />);
      await userEvent.type(screen.getByPlaceholderText('Find a task…'), typed);
      expect(screen.getByText('Valve check')).toBeInTheDocument();
      expect(screen.queryByText('Pump overhaul'), typed).toBeNull();
      expect(screen.queryByText('Gate repair'), typed).toBeNull();
      unmount();
    }
  });
});
