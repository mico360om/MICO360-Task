import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';
import { useAuthStore } from '../stores/auth-store';

// Tasks scheduled for the future (owner, 10 Nov 2026): a task waiting for a later start day is not in
// the Dashboard's "Your open tasks" or "Due soon" until that day.

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const task = (id: string, title: string, extra: Record<string, unknown>) => ({
  id, key: id.toUpperCase(), title, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0,
  completedAt: null, createdAt: '', updatedAt: '', boardDate: '2026-11-10T12:00:00.000Z', ...extra,
});
const TODAYS = task('t1', 'Check the drawings', { dueDate: '2026-11-12T00:00:00.000Z' });
const WAITING = task('t2', 'Pour the slab', { startDate: '2026-11-20T00:00:00.000Z', dueDate: '2026-11-20T00:00:00.000Z', boardDate: '2026-11-20T12:00:00.000Z' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T06:00:00Z'));
  useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/tasks/mine') || u.endsWith('/tasks')) return json({ data: [TODAYS, WAITING] });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

describe('Dashboard: tasks waiting for their start day', () => {
  it('are in neither “Your open tasks” nor “Due soon”', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const due = (await screen.findByRole('heading', { name: 'Due soon' })).closest('section')!;
    expect(await within(due).findByText('Check the drawings')).toBeInTheDocument();
    expect(within(due).queryByText('Pour the slab')).toBeNull();
    const open = screen.getByRole('heading', { name: 'Your open tasks' }).closest('section')!;
    expect(within(open).getByText('Check the drawings')).toBeInTheDocument();
    expect(within(open).queryByText('Pour the slab')).toBeNull();
  });
});
