import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskCard, type TaskCardTask } from './TaskCard';

// Kanban Board: Monthly View — a card shows its date span in the month view, in place of its due date.
const task: TaskCardTask = { key: 'MICO-1', title: 'Pour slab', priority: 'NORMAL', dueDate: '2099-01-20', progress: 0, assignees: [] };

describe('TaskCard in the month view', () => {
  it('shows its span instead of the due date', () => {
    render(<TaskCard task={{ ...task, dateLine: { text: '5–20 Jan', overdue: false } }} />);
    expect(screen.getByTestId('card-date')).toHaveTextContent('5–20 Jan');
    expect(screen.queryByText('20 Jan 2099')).not.toBeInTheDocument();
  });

  it('a carried card is marked overdue, its due day on hover', () => {
    render(<TaskCard task={{ ...task, dateLine: { text: 'Overdue · from Oct', overdue: true, title: 'Due 30 Oct' } }} />);
    const chip = screen.getByTestId('card-date');
    expect(chip).toHaveTextContent('Overdue · from Oct');
    expect(chip).toHaveAttribute('title', 'Due 30 Oct');
    expect(chip.className).toContain('text-danger');
  });

  it('a card without a due date still shows its line (“From 5 Nov”, “No date”)', () => {
    render(<TaskCard task={{ ...task, dueDate: null, dateLine: { text: 'No date', overdue: false } }} />);
    expect(screen.getByTestId('card-date')).toHaveTextContent('No date');
  });

  it('without a date line, the card is as before', () => {
    render(<TaskCard task={task} />);
    expect(screen.getByTestId('card-date')).toHaveTextContent('20 Jan 2099');
  });
});
