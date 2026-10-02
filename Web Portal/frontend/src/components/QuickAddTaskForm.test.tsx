import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAddTaskForm } from './QuickAddTaskForm';

describe('QuickAddTaskForm', () => {
  it('submits the title, priority, description and multiple assignees', async () => {
    const onSubmit = vi.fn();
    render(<QuickAddTaskForm onSubmit={onSubmit} assignees={[{ id: 'u9', label: 'omar' }, { id: 'u10', label: 'nadia' }]} />);
    await userEvent.type(screen.getByLabelText(/task title/i), 'New task');
    await userEvent.type(screen.getByLabelText(/description/i), 'Some detail');
    await userEvent.selectOptions(screen.getByLabelText(/priority/i), 'HIGH');
    await userEvent.click(screen.getByRole('checkbox', { name: 'omar' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'nadia' }));
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect(onSubmit).toHaveBeenCalledWith({ title: 'New task', priority: 'HIGH', description: 'Some detail', assigneeIds: ['u9', 'u10'] });
  });

  it('can make the new task repeat, previewing the dates from its due date', async () => {
    const onSubmit = vi.fn();
    render(<QuickAddTaskForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/task title/i), 'Weekly report');
    fireEvent.change(screen.getByLabelText(/^due date$/i), { target: { value: '2026-10-01' } });
    await userEvent.selectOptions(screen.getByLabelText(/^repeat$/i), 'WEEKLY');
    expect(screen.getByText(/^Next:/)).toHaveTextContent('Next: Thu, Oct 8 · Thu, Oct 15 · Thu, Oct 22');
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect(onSubmit).toHaveBeenCalledWith({ title: 'Weekly report', priority: 'NORMAL', description: '', assigneeIds: [], dueDate: '2026-10-01', recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
  });

  it('parses a natural-language description and prefills the fields', async () => {
    const onParse = vi.fn().mockResolvedValue({ title: 'Review the report', dueDate: '2026-09-18', priority: 'HIGH' });
    const onSubmit = vi.fn();
    render(<QuickAddTaskForm onSubmit={onSubmit} onParse={onParse} />);
    await userEvent.type(screen.getByPlaceholderText(/describe a task/i), 'review the report by Friday');
    await userEvent.click(screen.getByRole('button', { name: /parse/i }));
    expect(onParse).toHaveBeenCalledWith('review the report by Friday');
    expect(((await screen.findByLabelText(/task title/i)) as HTMLInputElement).value).toBe('Review the report');
    expect((screen.getByLabelText(/priority/i) as HTMLSelectElement).value).toBe('HIGH');
    expect((screen.getByLabelText(/due date/i) as HTMLInputElement).value).toBe('2026-09-18');
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect(onSubmit).toHaveBeenCalledWith({ title: 'Review the report', priority: 'HIGH', description: '', assigneeIds: [], dueDate: '2026-09-18' });
  });

  it('does not offer natural-language parsing when onParse is absent', () => {
    render(<QuickAddTaskForm onSubmit={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/describe a task/i)).toBeNull();
  });

  it('hides the assignee field when no assignees are provided', () => {
    render(<QuickAddTaskForm onSubmit={vi.fn()} />);
    expect(screen.queryByRole('group', { name: /assign to/i })).toBeNull();
  });

  it('does not submit an empty title', async () => {
    const onSubmit = vi.fn();
    render(<QuickAddTaskForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables the button while submitting', () => {
    render(<QuickAddTaskForm onSubmit={vi.fn()} submitting />);
    expect(screen.getByRole('button', { name: /adding/i })).toBeDisabled();
  });
});
