import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { TaskCard, type TaskCardTask } from './TaskCard';
import { useDensityStore } from '../lib/density';
import { OVERDUE_CLASS } from '../lib/colour-classes';
import { OVERDUE_TONES } from '../lib/colour-scheme';

/** The overdue date as a badge (owner, 10 Nov): a pill in the scheme's overdue pair, its words bold. */
const BADGE = ['rounded-full', 'px-2', 'py-0.5', 'font-semibold', 'bg-overdue-soft', 'text-overdue'];

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

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
  it('its stripe is its status’s colour; an overdue card keeps the normal border and says “Overdue” on a red badge (owner, 10 Nov)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T08:00:00Z'));
    const { rerender } = render(<TaskCard task={task} timeZone="Asia/Muscat" />);
    expect(card().querySelector('[data-card-stripe]')).toHaveStyle({ background: 'rgb(var(--c-status-progress))' });
    // The same neutral border as every other card: no red edge or ring around it (1.23.8's red edge is gone).
    expect(card()).toHaveClass('border-line');
    expect(card().className).not.toMatch(/(?:border|ring)-overdue|\bring-\d/);
    const lateCard = card().className;
    const date = screen.getByTestId('card-date');
    expect(date).toHaveTextContent('Overdue · 20 Nov 2026');
    expect(date.querySelector('svg')).not.toBeNull();
    expect(date).toHaveClass(...BADGE);
    // Exactly the card a task due later gets.
    rerender(<TaskCard task={{ ...task, dueDate: '2026-12-20' }} timeZone="Asia/Muscat" />);
    expect(card().className).toBe(lateCard);
    for (const cls of ['rounded-full', 'bg-overdue-soft', 'text-overdue']) expect(screen.getByTestId('card-date')).not.toHaveClass(cls);
  });

  it('the badge and the normal border in Compact, Comfortable and Detailed', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T08:00:00Z'));
    for (const density of ['compact', 'comfortable', 'detailed'] as const) {
      act(() => useDensityStore.getState().set(density));
      const { unmount } = render(<TaskCard task={task} timeZone="Asia/Muscat" />);
      expect(card(), density).toHaveClass('border-line');
      expect(card().className, density).not.toMatch(/(?:border|ring)-overdue|\bring-\d/);
      expect(screen.getByTestId('card-date'), density).toHaveClass(...BADGE);
      unmount();
    }
  });

  it('the board’s Month view: a carried card’s “Overdue · from Oct” is the same badge, the card’s border normal', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T08:00:00Z'));
    render(<TaskCard task={{ ...task, dueDate: '2026-10-30', dateLine: { text: 'Overdue · from Oct', overdue: true, title: 'Due 30 Oct' } }} timeZone="Asia/Muscat" />);
    expect(screen.getByTestId('card-date')).toHaveClass(...BADGE);
    expect(card()).toHaveClass('border-line');
    expect(card().className).not.toMatch(/(?:border|ring)-overdue|\bring-\d/);
  });

  it('the badge is the scheme’s overdue pair: dark red words on a pale red tint, light red on a dark red wash in dark mode, 4.5:1 or more', () => {
    const { light, dark } = OVERDUE_TONES;
    // Light: words darker than the red fill (dark red), on a tint lighter than both.
    expect(luminance(light.text)).toBeLessThan(luminance(light.fill));
    expect(luminance(light.soft)).toBeGreaterThan(luminance(light.text));
    expect(contrast(light.text, light.soft)).toBeGreaterThanOrEqual(4.5);
    // Dark: light red words on a dark red wash.
    expect(luminance(dark.text)).toBeGreaterThan(luminance(dark.soft));
    expect(contrast(dark.text, dark.soft)).toBeGreaterThanOrEqual(4.5);
    // The classes are the scheme's (lib/colour-classes), not written out.
    expect(BADGE).toEqual(expect.arrayContaining(OVERDUE_CLASS.chip.split(' ')));
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
    expect(screen.getByTestId('card-date')).not.toHaveClass('rounded-full');
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
