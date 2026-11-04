import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShortcutProvider } from './shortcuts/ShortcutProvider';
import { TaskDrawer, type TaskStepper } from './TaskDrawer';
import type { ApiTask } from '../api/tasks';

// 1.22: Previous / Next in the task panel's header — through the list the task was opened from.
const task: ApiTask = {
  id: 't3', key: 'MICO-3', title: 'Prepare monthly report', description: null, projectId: 'p1', columnId: 'c1', position: 0,
  priority: 'HIGH', startDate: null, dueDate: null, progress: 40, completedAt: null, createdAt: '', updatedAt: '',
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
const drawer = (stepper?: TaskStepper, extra: Record<string, unknown> = {}) =>
  wrap(<TaskDrawer task={task} checklist={[]} comments={[]} stepper={stepper} onSaveEdit={vi.fn()} onAddComment={vi.fn()} onClose={vi.fn()} {...extra} />);
const press = (code: string, key: string) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, code });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(e);
  });
};

beforeEach(() => localStorage.clear());

describe('the task panel’s Previous / Next', () => {
  it('shows “‹ Previous”, “3 of 18” and “Next ›” in the header', () => {
    drawer({ position: 3, total: 18, onPrevious: vi.fn(), onNext: vi.fn() });
    const steps = screen.getByRole('group', { name: 'Step through the list' });
    expect(within(steps).getByRole('button', { name: 'Previous task' })).toHaveTextContent('Previous');
    expect(within(steps).getByRole('button', { name: 'Next task' })).toHaveTextContent('Next');
    expect(within(steps).getByText('3 of 18')).toBeInTheDocument();
    expect(screen.getByTestId('task-header')).toContainElement(steps);
  });

  it('opens the task before or after it', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    drawer({ position: 3, total: 18, onPrevious, onNext });
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Previous task' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('is greyed out at the ends of the list', () => {
    drawer({ position: 1, total: 4, onNext: vi.fn() });
    expect(screen.getByRole('button', { name: 'Previous task' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next task' })).toBeEnabled();
  });

  it('J and K step too (and the buttons say so)', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    drawer({ position: 2, total: 3, onPrevious, onNext });
    expect(screen.getByRole('button', { name: 'Next task' })).toHaveAttribute('aria-keyshortcuts', 'J');
    expect(screen.getByRole('button', { name: 'Previous task' })).toHaveAttribute('aria-keyshortcuts', 'K');
    screen.getByRole('button', { name: 'Close' }).focus();
    press('KeyJ', 'j');
    expect(onNext).toHaveBeenCalledTimes(1);
    press('KeyK', 'k');
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('asks first when something typed in the panel isn’t saved, as the edit form does', async () => {
    const onNext = vi.fn();
    drawer({ position: 2, total: 3, onPrevious: vi.fn(), onNext });
    await userEvent.click(screen.getByRole('button', { name: 'Add a description' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), 'Half a thought');
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    const ask = screen.getByRole('alertdialog', { name: 'Discard your changes?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Half a thought');
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Discard' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('a comment being written counts as unsaved too; an empty box does not', async () => {
    const onNext = vi.fn();
    drawer({ position: 2, total: 3, onPrevious: vi.fn(), onNext });
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'On my way');
    screen.getByRole('button', { name: 'Close' }).focus();
    press('KeyJ', 'j');
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on the button it stepped with, in the next task’s panel', () => {
    drawer({ position: 4, total: 18, onPrevious: vi.fn(), onNext: vi.fn(), focus: 'next' });
    expect(screen.getByRole('button', { name: 'Next task' })).toHaveFocus();
  });

  it('at the end, focus goes to the other button (the one pressed is greyed out now)', () => {
    drawer({ position: 18, total: 18, onPrevious: vi.fn(), focus: 'next' });
    expect(screen.getByRole('button', { name: 'Previous task' })).toHaveFocus();
  });

  it('no list, no steps', () => {
    drawer(undefined);
    expect(screen.queryByRole('group', { name: 'Step through the list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next task' })).not.toBeInTheDocument();
  });
});
