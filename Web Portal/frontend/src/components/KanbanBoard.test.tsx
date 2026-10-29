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

  it('a long column name wraps onto a second line and, if still cut, gives its full name on hover', () => {
    render(<KanbanBoard columns={[{ id: 'c9', name: 'Waiting on the client / Blocked', color: '#C0422F', tasks: [] }]} />);
    const name = within(screen.getByRole('region', { name: 'Waiting on the client / Blocked' })).getByText('Waiting on the client / Blocked');
    expect(name).toHaveAttribute('title', 'Waiting on the client / Blocked');
    expect(name).toHaveClass('line-clamp-2');
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

  it('makes each card a single tab stop that opens with Enter', async () => {
    const onTaskClick = vi.fn();
    render(<KanbanBoard columns={columns} onTaskClick={onTaskClick} />);
    const card = screen.getByRole('button', { name: /MICO-1: Task A/ });
    expect(card).toHaveAttribute('tabindex', '0');
    expect(within(card).queryAllByRole('button')).toHaveLength(0); // no nested second tab stop
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(onTaskClick).toHaveBeenCalledWith('MICO-1');
  });

  it('never shows a finished card as overdue', () => {
    render(<KanbanBoard columns={[{ id: 'c9', name: 'Done', color: '#2E7D53', tasks: [{ ...mk('MICO-9', 'Shipped'), dueDate: '2000-01-01', done: true }] }]} />);
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });
});

describe('KanbanBoard — adding a task from a column', () => {
  const withEmpty: KanbanColumnData[] = [...columns, { id: 'c3', name: 'Review', color: '#7A4FA0', tasks: [] }];

  it('each column has an "Add a task" button for that column', async () => {
    const onAddTask = vi.fn();
    render(<KanbanBoard columns={withEmpty} onAddTask={onAddTask} />);
    await userEvent.click(within(screen.getByRole('region', { name: 'Done' })).getByRole('button', { name: 'Add a task to Done' }));
    expect(onAddTask).toHaveBeenCalledWith('c2');
    for (const name of ['To Do', 'Done', 'Review']) {
      expect(within(screen.getByRole('region', { name })).getByRole('button', { name: `Add a task to ${name}` })).toBeInTheDocument();
    }
  });

  it('an empty column’s box adds a task there too', async () => {
    const onAddTask = vi.fn();
    render(<KanbanBoard columns={withEmpty} onAddTask={onAddTask} />);
    const box = within(screen.getByRole('region', { name: 'Review' })).getByRole('button', { name: /no tasks.*add a task/i });
    expect(box).toHaveTextContent('or drop a card here');
    await userEvent.click(box);
    expect(onAddTask).toHaveBeenCalledWith('c3');
  });

  it('a collapsed column keeps its "Add a task" button', async () => {
    const onAddTask = vi.fn();
    render(<KanbanBoard columns={withEmpty} onAddTask={onAddTask} />);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Review' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Review' })).getByRole('button', { name: 'Add a task to Review' }));
    expect(onAddTask).toHaveBeenCalledWith('c3');
  });

  it('without a way to add (read-only), the columns offer none', () => {
    render(<KanbanBoard columns={withEmpty} />);
    expect(screen.queryByRole('button', { name: /add a task/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Review' })).getByText('Drop a card here')).toBeInTheDocument();
  });
});
