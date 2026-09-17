import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KanbanBoard } from './KanbanBoard';
import type { KanbanColumnData } from './KanbanColumn';

const mk = (key: string, title: string): import('./TaskCard').TaskCardTask => ({
  key,
  title,
  priority: 'NORMAL',
  dueDate: '2099-01-01',
  progress: 10,
  assignees: [],
});

const columns: KanbanColumnData[] = [
  { id: 'c1', name: 'To Do', color: '#3A6EA5', tasks: [mk('MICO-1', 'Task A'), mk('MICO-2', 'Task B')] },
  { id: 'c2', name: 'Done', color: '#2E7D53', tasks: [mk('MICO-3', 'Task C')] },
];

describe('KanbanBoard', () => {
  it('renders each column with its task count', () => {
    render(<KanbanBoard columns={columns} />);
    const todo = screen.getByRole('region', { name: 'To Do' });
    expect(within(todo).getByText('2')).toBeInTheDocument();
    const done = screen.getByRole('region', { name: 'Done' });
    expect(within(done).getByText('1')).toBeInTheDocument();
  });

  it('renders the task cards inside their columns', () => {
    render(<KanbanBoard columns={columns} />);
    expect(screen.getByText('Task A')).toBeInTheDocument();
    expect(screen.getByText('Task C')).toBeInTheDocument();
  });

  it('calls onTaskClick with the task key', async () => {
    const onTaskClick = vi.fn();
    render(<KanbanBoard columns={columns} onTaskClick={onTaskClick} />);
    await userEvent.click(screen.getByText('Task A'));
    expect(onTaskClick).toHaveBeenCalledWith('MICO-1');
  });
});
