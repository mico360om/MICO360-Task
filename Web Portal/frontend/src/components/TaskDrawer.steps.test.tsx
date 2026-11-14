import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShortcutProvider } from './shortcuts/ShortcutProvider';
import { TaskDrawer, type TaskStepper } from './TaskDrawer';
import type { ApiTask } from '../api/tasks';
import { GUEST_WORDS } from '../lib/guest-contacts';

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
afterEach(() => vi.unstubAllGlobals());

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

  // 1.22 QA: the title (and a checklist item being renamed) save themselves when you leave the box —
  // clicking Next leaves it. Asking "Discard?" then was wrong: the title was saved whatever you picked.
  it('a title or checklist item being edited is saved by stepping, as leaving the box saves it — no question', async () => {
    const onNext = vi.fn();
    const onSaveEdit = vi.fn();
    const onRenameChecklistItem = vi.fn();
    drawer({ position: 2, total: 3, onPrevious: vi.fn(), onNext }, { onSaveEdit, onRenameChecklistItem, checklist: [{ id: 'k1', text: 'Collect figures', done: false, position: 0 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Reworked report');
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(screen.queryByRole('alertdialog', { name: 'Discard your changes?' })).not.toBeInTheDocument();
    expect(onSaveEdit).toHaveBeenCalledWith({ title: 'Reworked report' }, undefined);
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Edit “Collect figures”' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Checklist item' }), ' and costs');
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(screen.queryByRole('alertdialog', { name: 'Discard your changes?' })).not.toBeInTheDocument();
    expect(onRenameChecklistItem).toHaveBeenCalledWith('k1', 'Collect figures and costs');
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it('a title that couldn’t be saved (left empty) still asks first', async () => {
    const onNext = vi.fn();
    drawer({ position: 2, total: 3, onPrevious: vi.fn(), onNext });
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
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

  // 1.22 review W1: a half-typed external contact was dropped by Next / J without asking.
  // tgc: 1.24 — external contacts are guests now: a half-typed New guest (in the Assign box) is what can be lost.
  it('a half-typed new guest counts as unsaved too (Next and J ask); an opened but empty one does not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const onNext = vi.fn();
    drawer({ position: 2, total: 3, onPrevious: vi.fn(), onNext }, { assignees: [{ id: 'u1', name: 'Ada' }], onAssignUser: vi.fn(), onAddGuest: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Add assignee' }));
    await userEvent.click(screen.getByRole('radio', { name: GUEST_WORDS.guest }));
    await userEvent.click(screen.getByRole('button', { name: GUEST_WORDS.newGuest }));
    const form = screen.getByRole('group', { name: GUEST_WORDS.newGuest });
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(onNext).toHaveBeenCalledTimes(1); // nothing typed yet
    await userEvent.type(within(form).getByRole('textbox', { name: 'Company' }), 'Northwind Tra');
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    const ask = screen.getByRole('alertdialog', { name: 'Discard your changes?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(within(form).getByRole('textbox', { name: 'Company' })).toHaveValue('Northwind Tra');
    screen.getByRole('button', { name: 'Close' }).focus();
    press('KeyJ', 'j');
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  // tgc: 1.24 — the contact editor this checked is gone; the Categories box's choice is the panel's other unsaved pick.
  it('a category choice being changed counts as unsaved once it differs from what is saved', async () => {
    const onNext = vi.fn();
    const choices = [{ id: 'k1', name: 'Electrical', color: 'teal', position: 0, retired: false }, { id: 'k2', name: 'HSE', color: 'gold', position: 1, retired: false }];
    drawer({ position: 2, total: 3, onPrevious: vi.fn(), onNext }, { task: { ...task, categories: [] }, categoryChoices: choices, onSetCategories: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Edit categories' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(onNext).toHaveBeenCalledTimes(1); // opened, not changed
    await userEvent.click(screen.getByRole('button', { name: 'HSE' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next task' }));
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
