import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryPicker } from './category-picker';
import type { ApiCategory } from '../../api/categories';
import { CATEGORY_WORDS } from '../../lib/task-categories';

// 1.24 Task categories: the multi-pick of a project's categories (the task form and the task panel).

const cat = (id: string, name: string, position: number, extra: Partial<ApiCategory> = {}): ApiCategory => ({
  id, projectId: 'p1', name, color: 'teal', position, retired: false, retiredAt: null, ...extra,
});
const LIST = [cat('k2', 'HSE', 1), cat('k1', 'Electrical', 0, { color: 'indigo' }), cat('k3', 'Old works', 2, { retired: true, retiredAt: '2026-11-01' }), cat('k4', 'Gone', 3, { retired: true, retiredAt: '2026-11-01' })];

function Picker(props: { kept?: string[]; start?: string[]; onChange?: (ids: string[]) => void }) {
  const [value, setValue] = useState<string[]>(props.start ?? []);
  return (
    <CategoryPicker
      categories={LIST}
      value={value}
      kept={props.kept}
      onChange={(ids) => {
        setValue(ids);
        props.onChange?.(ids);
      }}
    />
  );
}

describe('CategoryPicker', () => {
  it('lists the project’s categories in its order as toggles in their colours; retired ones only when already on the task, marked', () => {
    render(<Picker kept={['k3']} start={['k3']} />);
    const group = screen.getByRole('group', { name: CATEGORY_WORDS.pick });
    const names = within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Electrical', 'HSE', 'Old works (retired)']);
    expect(within(group).getByRole('button', { name: 'Old works (retired)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Electrical' })).toHaveAttribute('aria-pressed', 'false');
    // The colour of each comes from its own tones (a square swatch).
    expect(within(group).getByRole('button', { name: 'Electrical' }).getAttribute('style')).toMatch(/--cat-light-fill/);
  });

  it('picks and unpicks several, kept in the project’s order', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'HSE' }));
    await userEvent.click(screen.getByRole('button', { name: 'Electrical' }));
    expect(onChange).toHaveBeenLastCalledWith(['k1', 'k2']);
    expect(screen.getByRole('button', { name: 'HSE' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'HSE' }));
    expect(onChange).toHaveBeenLastCalledWith(['k1']);
  });

  // Browser check (axe, critical "aria-allowed-attr"): aria-required isn't allowed on role="group".
  it('a required pick says so in its name, never with aria-required (a group can’t have it)', () => {
    render(<CategoryPicker categories={LIST} value={[]} onChange={vi.fn()} required />);
    expect(screen.getByRole('group', { name: `${CATEGORY_WORDS.pick} (required)` })).not.toHaveAttribute('aria-required');
  });

  it('labelled by the form’s own label (which says “required”), it has no aria-required either', () => {
    render(
      <>
        <span id="cat-label">Categories (required)</span>
        <CategoryPicker categories={LIST} value={[]} onChange={vi.fn()} labelledBy="cat-label" required invalid />
      </>,
    );
    const group = screen.getByRole('group', { name: 'Categories (required)' });
    expect(group).not.toHaveAttribute('aria-required');
    expect(group).toHaveAttribute('aria-invalid', 'true');
  });

  it('says when the project has no categories', () => {
    render(<CategoryPicker categories={[]} value={[]} onChange={vi.fn()} />);
    expect(screen.getByText(CATEGORY_WORDS.none)).toBeInTheDocument();
  });
});
