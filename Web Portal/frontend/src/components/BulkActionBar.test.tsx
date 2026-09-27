import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('never applies a date while it is being typed — only on "Set date", and only a complete date', async () => {
    const onSetDueDate = vi.fn();
    render(<BulkActionBar {...baseProps} onSetDueDate={onSetDueDate} />);
    const input = screen.getByLabelText(/due date for selected tasks/i);
    const setBtn = screen.getByRole('button', { name: /set date/i });
    fireEvent.change(input, { target: { value: '0002-10-05' } }); // half-typed year
    expect(onSetDueDate).not.toHaveBeenCalled();
    expect(setBtn).toBeDisabled();
    fireEvent.change(input, { target: { value: '2026-10-05' } });
    expect(onSetDueDate).not.toHaveBeenCalled();
    await userEvent.click(setBtn);
    expect(onSetDueDate).toHaveBeenCalledWith('2026-10-05');
  });

  it('asks for confirmation before clearing every selected due date', async () => {
    const onSetDueDate = vi.fn();
    render(<BulkActionBar {...baseProps} onSetDueDate={onSetDueDate} />);
    await userEvent.click(screen.getByRole('button', { name: /clear date/i }));
    expect(onSetDueDate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/clear the due date on 2 tasks/i);
    await userEvent.click(screen.getByRole('button', { name: /^clear dates$/i }));
    expect(onSetDueDate).toHaveBeenCalledWith(null);
  });
});
