import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  useAuthStore.getState().setSession({
    user: { id: 'u1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] },
    accessToken: 'at',
    refreshToken: 'rt',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/reports/status')) return json({ data: { TODO: 1, DONE: 2 } });
      if (u.endsWith('/reports/projects')) return json({ data: [{ projectId: 'p1', projectName: 'P1', total: 7, completed: 3, overdue: 2, completionPct: 43 }] });
      if (u.endsWith('/tasks/mine')) return json({ data: [] });
      if (u.includes('/projects')) return json({ data: [{ id: 'p1' }, { id: 'p2' }] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  it('greets the user and shows live stat tiles from the API', async () => {
    renderPage();
    expect(screen.getByText(/welcome back, admin/i)).toBeInTheDocument();
    expect(screen.getByText('My tasks')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument()); // all-tasks total (unique)
  });

  it('lists only open tasks under “Your open tasks”, with company-zone due labels', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    const task = (id: string, title: string, extra: Record<string, unknown>) => ({
      id, key: id.toUpperCase(), title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra,
    });
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/tasks/mine')) return json({ data: [task('t1', 'Still open', { columnCategory: 'TODO' }), task('t2', 'Already shipped', { columnCategory: 'DONE' })] });
      if (u.endsWith('/tasks')) return json({ data: [task('t3', 'Finished early', { columnCategory: 'DONE', dueDate: '2026-01-01T00:00:00.000Z' })] });
      return json({ data: [] });
    });
    renderPage();
    expect(await screen.findByText('Still open')).toBeInTheDocument();
    expect(screen.queryByText('Already shipped')).not.toBeInTheDocument();
    // a finished task is never "due soon"/overdue
    await waitFor(() => expect(screen.getByText(/nothing due/i)).toBeInTheDocument());
    expect(screen.queryByText('Finished early')).not.toBeInTheDocument();
  });

  it('shows an error with Retry — not “all clear” — when the task list fails to load', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/tasks')) return new Response(JSON.stringify({ error: { code: 'ERROR', message: 'down' } }), { status: 500 });
      return json({ data: [] });
    });
    renderPage();
    expect(await screen.findByText(/couldn’t load due tasks/i)).toBeInTheDocument();
    expect(screen.queryByText(/you’re all clear/i)).not.toBeInTheDocument();
  });
});
