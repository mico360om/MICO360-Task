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
    expect(screen.getByRole('heading', { level: 1, name: /welcome back, admin/i })).toBeInTheDocument(); // the name sits in a <bdi>
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

  it('shows the charts as loading (not "no data") until the numbers arrive, and as an error if they fail', async () => {
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const ok = fetch;
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) => (String(args[0]).includes('/reports/') ? pending : ok(...args))));
    renderPage();
    expect(await screen.findByLabelText('Loading the status chart')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading project completion')).toBeInTheDocument();
    expect(screen.queryByText(/no data to chart yet/i)).not.toBeInTheDocument();
    release(new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }), { status: 500, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(screen.getByText(/Couldn’t load project completion/)).toBeInTheDocument());
    expect(screen.queryByText(/no data to chart yet/i)).not.toBeInTheDocument();
  });

  it('names the statuses in plain words and in board order (not raw codes like IN_PROGRESS)', async () => {
    const ok = fetch;
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) =>
      String(args[0]).endsWith('/reports/status') ? json({ data: { DONE: 2, IN_PROGRESS: 4, BACKLOG: 1 } }) : ok(...args),
    ));
    renderPage();
    const chart = await screen.findByRole('list', { name: /tasks by status/i });
    await waitFor(() => expect(chart).toHaveTextContent('In Progress'));
    expect(chart).not.toHaveTextContent(/IN_PROGRESS|BACKLOG/);
    const labels = [...chart.querySelectorAll('li')].map((li) => li.textContent?.split(':')[0]?.trim());
    expect(labels).toEqual(['Backlog', 'In Progress', 'Done']);
  });

  it('draws project completion against 100% — 43% is a 43% bar, not a full one', async () => {
    renderPage();
    const chart = await screen.findByRole('list', { name: /project completion/i });
    await waitFor(() => expect(chart).toHaveTextContent('43%'));
    expect((chart.querySelector('[data-bar]') as HTMLElement).style.width).toBe('43%');
  });

  it('keeps the person’s name apart from the greeting’s words (an Arabic name never reorders it)', () => {
    renderPage();
    const heading = screen.getByRole('heading', { level: 1, name: /welcome back, admin/i });
    expect(heading.querySelector('bdi')).toHaveTextContent('admin');
  });

  it('lays out the stat tiles for how many there are: four for an administrator, two for anyone else', async () => {
    const { unmount } = renderPage();
    expect(screen.getByTestId('stat-tiles')).toHaveAttribute('data-count', '4');
    unmount();
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    renderPage();
    const tiles = screen.getByTestId('stat-tiles');
    expect(tiles).toHaveAttribute('data-count', '2');
    expect(tiles.className).not.toMatch(/lg:grid-cols-4/);
  });

  it('holds the place of the lists while they load (rows, not a line of text), so nothing jumps', async () => {
    const ok = fetch;
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) => (/\/(tasks|activity)/.test(String(args[0])) ? new Promise<Response>(() => {}) : ok(...args))));
    renderPage();
    const due = await screen.findByLabelText('Loading due tasks');
    expect(due.querySelectorAll('[data-skeleton-row]').length).toBeGreaterThanOrEqual(5);
    const activity = screen.getByLabelText('Loading recent activity');
    expect(activity.querySelectorAll('[data-skeleton-row]').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });
});
