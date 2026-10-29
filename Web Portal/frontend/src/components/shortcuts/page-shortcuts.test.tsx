import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShortcutProvider } from './ShortcutProvider';
import { TaskDrawer } from '../TaskDrawer';
import { NewTaskButton } from '../NewTaskButton';
import type { ApiTask } from '../../api/tasks';

const task: ApiTask = {
  id: 't1',
  key: 'MICO-1',
  title: 'Prepare monthly report',
  description: 'Gather figures and write it up.',
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'HIGH',
  startDate: null,
  dueDate: null,
  progress: 40,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
};

function wrap(ui: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ShortcutProvider>{ui}</ShortcutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function press(init: { key: string; code: string }) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(e);
  });
  return e;
}

beforeEach(() => localStorage.clear());

describe('the task panel’s shortcuts', () => {
  it('edits the task with E and asks to delete it with Delete, the safe answer focused', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    wrap(<TaskDrawer task={task} checklist={[]} comments={[]} onEdit={onEdit} onDelete={onDelete} onClose={vi.fn()} />);
    screen.getByRole('button', { name: 'Close' }).focus();
    press({ key: 'e', code: 'KeyE' });
    expect(onEdit).toHaveBeenCalledTimes(1);
    press({ key: 'Delete', code: 'Delete' });
    expect(screen.getByRole('group', { name: 'Confirm delete' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('shows the shortcuts on its Edit and Delete buttons', () => {
    wrap(<TaskDrawer task={task} checklist={[]} comments={[]} onEdit={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);
    const edit = screen.getByRole('button', { name: 'Edit task' });
    expect(edit.getAttribute('title')).toBe('Edit every detail of the task (E)');
    expect(edit.getAttribute('aria-keyshortcuts')).toBe('E');
    expect(screen.getByRole('button', { name: /delete task/i }).getAttribute('aria-keyshortcuts')).toBe('Delete');
  });

  it('does nothing with E while typing a comment', () => {
    const onEdit = vi.fn();
    wrap(
      <TaskDrawer task={task} checklist={[]} comments={[]} onEdit={onEdit} onAddComment={vi.fn()} onClose={vi.fn()} />,
    );
    const box = screen.getAllByRole('textbox').at(-1)!;
    box.focus();
    press({ key: 'e', code: 'KeyE' });
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('Add new', () => {
  it('opens the New task form with N, and the button says so', () => {
    wrap(<NewTaskButton shortcutPriority={0} />);
    expect(screen.getByRole('button', { name: /new task/i }).getAttribute('title')).toBe('New task (N)');
    press({ key: 'n', code: 'KeyN' });
    expect(screen.getByRole('dialog', { name: /new task/i })).toBeTruthy();
  });

  it('the New task button is finger-sized on a touch screen wherever it sits (44px; a page header gave it 36px)', () => {
    wrap(<NewTaskButton className="extra" />);
    const button = screen.getByRole('button', { name: /new task/i });
    expect(button.className).toContain('[@media(pointer:coarse)]:!min-h-11');
    expect(button).toHaveClass('extra');
  });
});
