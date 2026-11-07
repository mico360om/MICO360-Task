import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { TaskCard, type TaskCardTask } from './TaskCard';
import { useDensityStore } from '../lib/density';

const task: TaskCardTask = {
  key: 'MICO-1',
  title: 'Prepare the monthly progress report for the client with photos of levels 4 to 6',
  priority: 'HIGH',
  dueDate: '2026-11-20',
  progress: 40,
  assignees: [
    { id: 'u1', name: 'Ada Lovelace' },
    { id: 'u2', name: 'Omar Al Said' },
    { id: 'u3', name: 'Sara Khan' },
    { id: 'u4', name: 'Bilal Ahmed' },
    { id: 'u5', name: 'Zara Malik' },
  ],
  counts: { comments: 0, attachments: 0, checklistDone: 2, checklistTotal: 5 },
  accentColor: 'rgb(var(--c-status-progress))',
  description: 'Collect the site photos from Omar.\nThen write the summary.',
  tags: [
    { id: 't1', name: 'Client', color: '#3A6EA5' },
    { id: 't2', name: 'Monthly', color: '#8B1E1E' },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  act(() => useDensityStore.getState().set('comfortable'));
});
const card = () => screen.getByRole('button', { name: /MICO-1/ });

describe('the card in the one colour scheme (1.23.8)', () => {
  it('its stripe is its status’s colour; an overdue card adds a red edge on top, and says “Overdue” in red', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T08:00:00Z'));
    render(<TaskCard task={task} timeZone="Asia/Muscat" />);
    expect(card().querySelector('[data-card-stripe]')).toHaveStyle({ background: 'rgb(var(--c-status-progress))' });
    expect(card()).toHaveClass('border-overdue');
    const date = screen.getByTestId('card-date');
    expect(date).toHaveTextContent('Overdue · 20 Nov 2026');
    expect(date).toHaveClass('bg-overdue-soft', 'text-overdue');
  });

  it('due today or tomorrow: amber, and says so in words', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T08:00:00Z'));
    render(<TaskCard task={task} timeZone="Asia/Muscat" />);
    const date = screen.getByTestId('card-date');
    expect(date).toHaveTextContent('Due tomorrow · 20 Nov 2026');
    expect(date).toHaveClass('text-soon');
    expect(card()).not.toHaveClass('border-overdue');
  });

  it('a later date stays plain; a finished or waiting task is never amber or red', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T08:00:00Z'));
    const { rerender } = render(<TaskCard task={task} timeZone="Asia/Muscat" />);
    expect(screen.getByTestId('card-date')).toHaveTextContent(/^20 Nov 2026$/);
    expect(screen.getByTestId('card-date')).not.toHaveClass('text-soon');
    vi.setSystemTime(new Date('2026-11-25T08:00:00Z'));
    rerender(<TaskCard task={{ ...task, done: true }} timeZone="Asia/Muscat" />);
    expect(card()).not.toHaveClass('border-overdue');
    rerender(<TaskCard task={{ ...task, awaitingApproval: true }} timeZone="Asia/Muscat" />);
    expect(card()).not.toHaveClass('border-overdue');
  });

  it('a Blocked card says so in the Blocked red (its stripe is red too), with no amber ring', () => {
    render(<TaskCard task={{ ...task, blocked: true, accentColor: 'rgb(var(--c-status-blocked))' }} />);
    expect(screen.getByText('Blocked')).toHaveClass('bg-status-blocked-soft', 'text-status-blocked');
    expect(card().className).not.toMatch(/ring-warning/);
  });
});

describe('Detailed cards (1.23.8)', () => {
  it('comfortable: the title may be clamped (its tooltip has it all); no description, tags or names line', () => {
    render(<TaskCard task={task} />);
    expect(screen.getByText(task.title)).toHaveClass('line-clamp-2');
    expect(screen.queryByText('Collect the site photos from Omar.')).toBeNull();
    expect(screen.queryByText('Client')).toBeNull();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('detailed: the whole title (it wraps), the description’s first line, the checklist count, tags and everyone on it', () => {
    act(() => useDensityStore.getState().set('detailed'));
    render(<TaskCard task={task} />);
    expect(screen.getByText(task.title)).not.toHaveClass('line-clamp-2');
    expect(screen.getByTestId('card-description')).toHaveTextContent(/^Collect the site photos from Omar\.$/);
    expect(screen.getByLabelText('Subtasks done')).toHaveTextContent('2/5');
    const tags = screen.getByTestId('card-tags');
    expect(within(tags).getByText('Client')).toBeInTheDocument();
    expect(within(tags).getByText('Monthly')).toBeInTheDocument();
    // Everyone, by name — no “+2”.
    expect(screen.queryByText('+2')).toBeNull();
    expect(screen.getByTestId('card-people')).toHaveTextContent('Ada Lovelace, Omar Al Said, Sara Khan, Bilal Ahmed, Zara Malik');
  });

  it('detailed: its project wherever cards come from several projects (the All projects board)', () => {
    act(() => useDensityStore.getState().set('detailed'));
    render(<TaskCard task={{ ...task, project: { name: 'Rig 7 refurbishment', code: 'RIG' } }} />);
    expect(screen.getByTestId('card-project')).toHaveTextContent('Rig 7 refurbishment');
  });

  it('detailed without a description, tags or people: nothing empty is drawn', () => {
    act(() => useDensityStore.getState().set('detailed'));
    render(<TaskCard task={{ ...task, description: '  ', tags: [], assignees: [] }} />);
    expect(screen.queryByTestId('card-description')).toBeNull();
    expect(screen.queryByTestId('card-tags')).toBeNull();
    expect(screen.queryByTestId('card-people')).toBeNull();
  });
});
