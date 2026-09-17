import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavedViewsBar } from './SavedViewsBar';
import { EMPTY_FILTERS, type TaskFilters } from '../lib/savedViews';

const filters = (over: Partial<TaskFilters> = {}): TaskFilters => ({ ...EMPTY_FILTERS, ...over });

describe('SavedViewsBar', () => {
  beforeEach(() => localStorage.clear());

  it('renders the built-in presets', () => {
    render(<SavedViewsBar current={EMPTY_FILTERS} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /My overdue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /This sprint/i })).toBeInTheDocument();
  });

  it('applies a preset’s filters when its chip is clicked', async () => {
    const onApply = vi.fn();
    render(<SavedViewsBar current={EMPTY_FILTERS} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: /My overdue/i }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ due: 'overdue' }));
  });

  it('saves the current filters as a new named view', async () => {
    render(<SavedViewsBar current={filters({ priority: 'HIGH' })} onApply={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /save view/i }));
    await userEvent.type(screen.getByPlaceholderText(/name this view/i), 'Hot list');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('button', { name: 'Hot list' })).toBeInTheDocument();
  });
});
