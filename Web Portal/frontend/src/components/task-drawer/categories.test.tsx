import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoriesBox } from './categories';
import { CATEGORY_WORDS } from '../../lib/task-categories';

// 1.24 The task panel's Categories box: the task's categories as chips, changed from the project's list.

const CHOICES = [
  { id: 'k1', name: 'Electrical', color: 'indigo', position: 0, retired: false },
  { id: 'k2', name: 'HSE', color: 'teal', position: 1, retired: false },
  { id: 'k3', name: 'Old works', color: 'gold', position: 2, retired: true },
];
const box = () => screen.getByRole('region', { name: CATEGORY_WORDS.heading });

describe('CategoriesBox', () => {
  it('shows the task’s categories as chips in their colours (a retired one marked)', () => {
    render(<CategoriesBox categories={[{ id: 'k1', name: 'Electrical', color: 'indigo', retired: false }, { id: 'k3', name: 'Old works', color: 'gold', retired: true }]} choices={CHOICES} />);
    expect(within(box()).getByRole('img', { name: 'Category: Electrical' })).toBeInTheDocument();
    expect(within(box()).getByRole('img', { name: 'Category: Old works (retired)' })).toBeInTheDocument();
    // Read-only: nothing to change.
    expect(within(box()).queryByRole('button')).toBeNull();
  });

  it('says “Needs a category” when the project asks every task for one and this has none', () => {
    const { rerender } = render(<CategoriesBox categories={[]} choices={CHOICES} requireCategory />);
    expect(within(box()).getByText(CATEGORY_WORDS.needs)).toBeInTheDocument();
    rerender(<CategoriesBox categories={[]} choices={CHOICES} />);
    expect(within(box()).queryByText(CATEGORY_WORDS.needs)).toBeNull();
    expect(within(box()).getByText(CATEGORY_WORDS.noneOnTask)).toBeInTheDocument();
  });

  it('Edit: picks from the project’s list and saves the new set', async () => {
    const onSave = vi.fn(async () => {});
    render(<CategoriesBox categories={[{ id: 'k1', name: 'Electrical', color: 'indigo', retired: false }]} choices={CHOICES} onSave={onSave} />);
    await userEvent.click(within(box()).getByRole('button', { name: 'Edit categories' }));
    const pick = within(box()).getByRole('group', { name: CATEGORY_WORDS.pick });
    expect(within(pick).getByRole('button', { name: 'Electrical' })).toHaveAttribute('aria-pressed', 'true');
    // A retired category the task hasn't got isn't offered.
    expect(within(pick).queryByRole('button', { name: /Old works/ })).toBeNull();
    await userEvent.click(within(pick).getByRole('button', { name: 'HSE' }));
    await userEvent.click(within(box()).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(['k1', 'k2']);
    expect(await within(box()).findByText('Saved')).toBeInTheDocument();
    expect(within(box()).queryByRole('group', { name: CATEGORY_WORDS.pick })).toBeNull();
  });

  it('a project that needs one: none picked can’t be saved', async () => {
    const onSave = vi.fn(async () => {});
    render(<CategoriesBox categories={[{ id: 'k1', name: 'Electrical', color: 'indigo', retired: false }]} choices={CHOICES} requireCategory onSave={onSave} />);
    await userEvent.click(within(box()).getByRole('button', { name: 'Edit categories' }));
    await userEvent.click(within(box()).getByRole('button', { name: 'Electrical' }));
    await userEvent.click(within(box()).getByRole('button', { name: 'Save' }));
    expect(within(box()).getByRole('alert')).toHaveTextContent(CATEGORY_WORDS.pickOne);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and keeps the choice open', async () => {
    const onSave = vi.fn(async () => {
      throw new Error(CATEGORY_WORDS.retiredPick);
    });
    render(<CategoriesBox categories={[]} choices={CHOICES} onSave={onSave} />);
    await userEvent.click(within(box()).getByRole('button', { name: 'Edit categories' }));
    await userEvent.click(within(box()).getByRole('button', { name: 'HSE' }));
    await userEvent.click(within(box()).getByRole('button', { name: 'Save' }));
    expect(await within(box()).findByRole('alert')).toHaveTextContent(CATEGORY_WORDS.retiredPick);
    expect(within(box()).getByRole('group', { name: CATEGORY_WORDS.pick })).toBeInTheDocument();
  });

  it('Cancel leaves the categories as they were; a changed choice counts as unsaved', async () => {
    const onSave = vi.fn();
    render(<CategoriesBox categories={[]} choices={CHOICES} onSave={onSave} />);
    await userEvent.click(within(box()).getByRole('button', { name: 'Edit categories' }));
    const editor = within(box()).getByRole('group', { name: CATEGORY_WORDS.pick }).parentElement!;
    expect(box().querySelector('[data-unsaved]')).toBeNull();
    await userEvent.click(within(box()).getByRole('button', { name: 'HSE' }));
    expect(box().querySelector('[data-unsaved]')).not.toBeNull();
    expect(editor).toBeInTheDocument();
    await userEvent.click(within(box()).getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(box()).getByText(CATEGORY_WORDS.noneOnTask)).toBeInTheDocument();
  });
});
