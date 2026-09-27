import { describe, it, expect, vi, afterEach } from 'vitest';
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

afterEach(() => vi.useRealTimers());

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

  it('is not overdue on its own due day in the company time zone (even after 04:00 Muscat)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z')); // 14:00 in Muscat, on the due day
    render(<TaskCard task={{ ...task, dueDate: '2026-09-30T00:00:00.000Z' }} timeZone="Asia/Muscat" />);
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
    expect(screen.getByText('Sep 30, 2026')).toBeInTheDocument();
  });

  it('becomes overdue the next company day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T20:30:00Z')); // 00:30 on Oct 1 in Muscat
    render(<TaskCard task={{ ...task, dueDate: '2026-09-30T00:00:00.000Z' }} timeZone="Asia/Muscat" />);
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it('never flags a finished task as overdue', () => {
    render(<TaskCard task={{ ...task, dueDate: '2000-01-01', done: true }} />);
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it('sets dir="auto" on the title so Arabic titles read right-to-left', () => {
    render(<TaskCard task={{ ...task, title: 'مراجعة التقرير الشهري' }} />);
    expect(screen.getByText('مراجعة التقرير الشهري')).toHaveAttribute('dir', 'auto');
  });

  it('is a single plain element (no button role / tab stop) when not interactive', () => {
    render(<TaskCard task={task} interactive={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
