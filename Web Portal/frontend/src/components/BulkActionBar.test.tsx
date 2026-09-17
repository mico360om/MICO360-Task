import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActionBar } from './BulkActionBar';

const baseProps = {
  count: 2,
  assignees: [{ value: 'u1', label: 'Ada' }, { value: 'u2', label: 'Omar' }],
  onComplete: vi.fn(),
  onSetDueDate: vi.fn(),
  onSetPriority: vi.fn(),
  onAssign: vi.fn(),
  onClear: vi.fn(),
};

describe('BulkActionBar', () => {
  it('shows how many tasks are selected', () => {
    render(<BulkActionBar {...baseProps} />);
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
  });

  it('completes the selection', async () => {
    const onComplete = vi.fn();
    render(<BulkActionBar {...baseProps} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole('button', { name: /complete/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('sets a priority on the selection', async () => {
    const onSetPriority = vi.fn();
    render(<BulkActionBar {...baseProps} onSetPriority={onSetPriority} />);
    await userEvent.selectOptions(screen.getByLabelText(/set priority/i), 'HIGH');
    expect(onSetPriority).toHaveBeenCalledWith('HIGH');
  });

  it('reassigns the selection', async () => {
    const onAssign = vi.fn();
    render(<BulkActionBar {...baseProps} onAssign={onAssign} />);
    await userEvent.selectOptions(screen.getByLabelText(/assign to/i), 'u2');
    expect(onAssign).toHaveBeenCalledWith('u2');
  });

  it('offers a move control only when columns are provided', async () => {
    const onMove = vi.fn();
    const { rerender } = render(<BulkActionBar {...baseProps} />);
    expect(screen.queryByLabelText(/move to/i)).toBeNull();
    rerender(<BulkActionBar {...baseProps} columns={[{ value: 'c1', label: 'Review' }]} onMove={onMove} />);
    await userEvent.selectOptions(screen.getByLabelText(/move to/i), 'c1');
    expect(onMove).toHaveBeenCalledWith('c1');
  });

  it('clears the selection', async () => {
    const onClear = vi.fn();
    render(<BulkActionBar {...baseProps} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
