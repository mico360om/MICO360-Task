import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskCard, type TaskCardTask } from './TaskCard';

const task: TaskCardTask = {
  key: 'MICO-1',
  title: 'Prepare monthly report',
  priority: 'URGENT',
  dueDate: '2099-01-01',
  progress: 40,
  assignees: [
    { id: 'u1', name: 'Ada Lovelace' },
    { id: 'u2', name: 'Omar A' },
  ],
  counts: { comments: 2, attachments: 1, checklistDone: 3, checklistTotal: 5 },
};

describe('TaskCard', () => {
  it('renders the key, title and priority', () => {
    render(<TaskCard task={task} />);
    expect(screen.getByText('MICO-1')).toBeInTheDocument();
    expect(screen.getByText('Prepare monthly report')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('shows an avatar for each assignee', () => {
    render(<TaskCard task={task} />);
    expect(screen.getByTitle('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByTitle('Omar A')).toBeInTheDocument();
  });

  it('shows the single assignee name, checklist progress and comment/attachment counts', () => {
    render(<TaskCard task={{ ...task, assignees: [{ id: 'u1', name: 'Ada Lovelace' }] }} />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument(); // checklist done/total
    expect(screen.getByLabelText('Comments')).toHaveTextContent('2');
    expect(screen.getByLabelText('Attachments')).toHaveTextContent('1');
  });

  it('flags an overdue due date', () => {
    render(<TaskCard task={{ ...task, dueDate: '2000-01-01' }} />);
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it('fires onClick when the card is activated', async () => {
    const onClick = vi.fn();
    render(<TaskCard task={task} onClick={onClick} />);
    await userEvent.click(screen.getByText('Prepare monthly report'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
