import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksPage } from './MyTasksPage';

// Tasks scheduled for the future (owner, 10 Nov 2026): a task waiting for its start day (on a later
// day's board) is under "Upcoming" in My Tasks — out of the main list and the Open / Overdue counts.

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const task = (id: string, key: string, title: string, o: Record<string, unknown> = {}) => ({
  id, key, title, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL',
  startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', boardDate: '2026-11-10T12:00:00.000Z', ...o,
});
const TASKS = [
  task('t1', 'MICO-1', 'Today’s work', { dueDate: '2026-11-12T00:00:00.000Z' }),
  task('t2', 'MICO-2', 'Late work', { dueDate: '2026-11-05T00:00:00.000Z', boardDate: '2026-11-10T12:00:00.000Z' }),
  task('t3', 'MICO-3', 'Pour the slab', { startDate: '2026-11-20T00:00:00.000Z', dueDate: '2026-11-22T00:00:00.000Z', boardDate: '2026-11-20T12:00:00.000Z' }),
  task('t4', 'MICO-4', 'Set out the site', { startDate: '2026-11-14T00:00:00.000Z', boardDate: '2026-11-14T12:00:00.000Z' }),
  task('t5', 'MICO-5', 'Finished early', { columnCategory: 'DONE', completedAt: '2026-11-09T08:00:00.000Z', boardDate: '2026-11-09T12:00:00.000Z' }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T06:00:00Z')); // 10:00 on 10 Nov in Muscat
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/tasks/mine')) return json({ data: TASKS });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) });

describe('My Tasks: Upcoming', () => {
  it('waiting tasks are under “Upcoming”, soonest start first, each saying when it starts — not in the main list', async () => {
    renderPage();
    const upcoming = await screen.findByRole('region', { name: 'Upcoming' });
    const cards = within(upcoming).getAllByRole('button', { name: /Pour the slab|Set out the site/ });
    expect(cards.map((b) => b.textContent)).toEqual(['Set out the site', 'Pour the slab']);
    expect(within(upcoming).getByText('Starts 14 Nov')).toBeInTheDocument();
    expect(within(upcoming).getByText('Starts 20 Nov')).toBeInTheDocument();
    const main = screen.getByRole('region', { name: 'Your tasks' });
    expect(within(main).queryByText('Pour the slab')).toBeNull();
    expect(within(main).getByText('Today’s work')).toBeInTheDocument();
  });

  it('the Open and Overdue counts leave them out; the Upcoming chip counts them and shows only them', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Upcoming' });
    expect(chip('All')).toHaveTextContent('5');
    expect(chip('Open')).toHaveTextContent('2');
    expect(chip('Overdue')).toHaveTextContent('1');
    expect(chip('Upcoming')).toHaveTextContent('2');
    expect(chip('Completed')).toHaveTextContent('1');
    await userEvent.click(chip('Upcoming'));
    expect(chip('Upcoming')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByText('Today’s work')).toBeNull());
    expect(screen.getByText('Pour the slab')).toBeInTheDocument();
    expect(screen.getByText('Set out the site')).toBeInTheDocument();
  });

  it('the Open chip lists today’s open tasks; the waiting ones stay under Upcoming', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Upcoming' });
    await userEvent.click(chip('Open'));
    const main = screen.getByRole('region', { name: 'Your tasks' });
    expect(within(main).getByText('Today’s work')).toBeInTheDocument();
    expect(within(main).queryByText('Pour the slab')).toBeNull();
  });

  it('on its start day it is one of today’s tasks again', async () => {
    vi.setSystemTime(new Date('2026-11-14T06:00:00Z'));
    renderPage();
    const main = await screen.findByRole('region', { name: 'Your tasks' });
    await waitFor(() => expect(within(main).getByText('Set out the site')).toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'Upcoming' })).queryByText('Set out the site')).toBeNull();
  });

  it('in the List and Table views too', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Upcoming' });
    await userEvent.click(screen.getByRole('button', { name: 'List view' }));
    // (Once in its columns, once on the phone's second line.)
    expect(within(screen.getByRole('region', { name: 'Upcoming' })).getAllByText('Starts 20 Nov').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(within(screen.getByRole('region', { name: 'Upcoming' })).getByText('Pour the slab')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Your tasks' })).queryByText('Pour the slab')).toBeNull();
  });
});
