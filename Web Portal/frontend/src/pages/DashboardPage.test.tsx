import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('opens a task through the address (?task=<id>), so a reload or a shared link opens it again', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    const task = { id: 't1', key: 'T1', title: 'Still open', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', columnCategory: 'TODO' };
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => json({ data: String(url).endsWith('/tasks/mine') ? [task] : [] }));
    let search = '';
    function Address() {
      search = useLocation().search;
      return null;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <DashboardPage />
          <Address />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Still open/ }));
    await waitFor(() => expect(new URLSearchParams(search).get('task')).toBe('t1'));
    // The app's one task panel (in the app shell) opens it from there; the page has none of its own.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

  it('four stat tiles in a row on a wide screen, for an administrator and for anyone else', async () => {
    const { unmount } = renderPage();
    expect(screen.getByTestId('stat-tiles')).toHaveAttribute('data-count', '4');
    expect(screen.getByTestId('stat-tiles').className).toMatch(/lg:grid-cols-4/);
    unmount();
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    renderPage();
    const tiles = screen.getByTestId('stat-tiles');
    expect(tiles).toHaveAttribute('data-count', '4');
    expect(tiles.className).toMatch(/lg:grid-cols-4/);
    expect(tiles.querySelectorAll('a')).toHaveLength(4);
  });

  it('an employee sees their own Overdue and Due this week, counted in the company’s week (from the tasks the page loads)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T06:00:00Z')); // Wednesday 28 Oct, 10:00 in Muscat
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    const task = (id: string, dueDate: string | null, extra: Record<string, unknown> = {}) => ({
      id, key: id.toUpperCase(), title: id, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra,
    });
    const mine = [task('late', '2026-10-27'), task('done-late', '2026-10-26', { columnCategory: 'DONE' }), task('today', '2026-10-28'), task('fri', '2026-10-30'), task('sat', '2026-10-31'), task('none', null)];
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      asked.push(u);
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', weekStart: 6, productName: '', companyName: '', serverTime: new Date().toISOString() } });
      if (u.endsWith('/tasks/mine')) return json({ data: mine });
      if (u.includes('/projects')) return json({ data: [{ id: 'p1' }] });
      return json({ data: [] });
    }));
    try {
      renderPage();
      const tiles = screen.getByTestId('stat-tiles');
      // The company's week runs Saturday to Friday: Saturday 31 Oct is next week's.
      const tile = (label: string) => screen.getByText(label, { selector: '*' }).closest('a')!;
      await waitFor(() => expect(tile('Due this week')).toHaveTextContent(/^2\s*Due this week/));
      expect(tile('Overdue')).toHaveTextContent(/^1\s*Overdue\s*Past their due day$/);
      expect(tiles).toHaveTextContent('Today – Fri 30 Oct');
      expect(screen.getByRole('link', { name: /Overdue/ })).toHaveAttribute('href', '/my-tasks');
      expect(screen.getByRole('link', { name: /Due this week/ })).toHaveAttribute('href', '/my-tasks');
      // Counted from the tasks the page already loads: nothing new is asked of the server.
      expect(asked.some((u) => /\/reports\//.test(u))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a task waiting for approval is not overdue: not in the Overdue tile, and Due soon shows its badge instead of "Nd overdue" (owner, 30 Oct)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T06:00:00Z')); // Wednesday 28 Oct, 10:00 in Muscat
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    const task = (id: string, dueDate: string | null, extra: Record<string, unknown> = {}) => ({
      id, key: id.toUpperCase(), title: id, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra,
    });
    const mine = [task('handed-in', '2026-10-26', { columnCategory: 'REVIEW', approvalRequestedAt: '2026-10-27T08:00:00.000Z' }), task('late', '2026-10-25')];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', weekStart: 0, productName: '', companyName: '', serverTime: new Date().toISOString() } });
      if (u.endsWith('/tasks/mine') || /\/tasks(\?|$)/.test(u)) return json({ data: mine });
      if (u.includes('/projects')) return json({ data: [{ id: 'p1' }] });
      return json({ data: [] });
    }));
    try {
      renderPage();
      const tile = (label: string) => screen.getByText(label, { selector: '*' }).closest('a')!;
      await waitFor(() => expect(tile('Overdue')).toHaveTextContent(/^1\s*Overdue/));
      const dueSoon = screen.getByRole('heading', { name: 'Due soon' }).closest('section')!;
      await waitFor(() => expect(within(dueSoon).getByText('handed-in')).toBeInTheDocument());
      const row = within(dueSoon).getByText('handed-in').closest('button')!;
      expect(row).toHaveTextContent('Waiting for approval');
      expect(row).not.toHaveTextContent(/overdue/i);
      expect(within(dueSoon).getByText('late').closest('button')!).toHaveTextContent('3d overdue');
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts the stat tiles two to a row even on a phone (one per row left a phone screenful of two numbers)', () => {
    renderPage();
    expect(screen.getByTestId('stat-tiles').className).toMatch(/(^|\s)grid-cols-2(\s|$)/);
  });

  it('on a company’s first day (no projects, no tasks) welcomes the administrator and points to the first steps instead of empty charts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] })));
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: /set up your workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /^welcome, admin/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/projects?new=1');
    expect(screen.getByRole('link', { name: 'Add your team' })).toHaveAttribute('href', '/admin/users?new=1');
    expect(screen.queryByText(/no data to chart yet/i)).not.toBeInTheDocument();
    // The band's "Open board" / "View my tasks" lead to empty pages on day one: the steps replace them.
    expect(screen.queryByRole('link', { name: 'Open board' })).not.toBeInTheDocument();
  });

  it('an employee on no project yet is told so, and may start one', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] })));
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: /not on a project yet/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a project' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add your team' })).not.toBeInTheDocument();
  });

  it('is not a first day while anything is still loading or failed to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).endsWith('/tasks') ? new Response(JSON.stringify({ error: { code: 'X', message: 'down' } }), { status: 500 }) : json({ data: [] }),
    ));
    renderPage();
    expect(await screen.findByText(/couldn’t load due tasks/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /set up your workspace/i })).not.toBeInTheDocument();
  });

  it('says who was given a task in Recent activity (“assigned MICO-3 to Omar”, not “assigned to MICO-3”)', async () => {
    const ok = fetch;
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) =>
      String(args[0]).endsWith('/activity')
        ? json({ data: [{ id: 'a1', action: 'ASSIGNED', createdAt: new Date().toISOString(), meta: { assignee: 'Omar Ahmed' }, actor: { id: 'u1', name: 'Aisha Khan' }, task: { id: 't3', key: 'MICO-3', title: 'x' } }] })
        : ok(...args),
    ));
    renderPage();
    const line = (await screen.findByRole('button', { name: 'MICO-3' })).closest('p')!;
    expect(line).toHaveTextContent('Aisha Khan assigned MICO-3 to Omar Ahmed');
  });

  it('a project’s companies changed reads “changed the companies of {project}” in Recent activity', async () => {
    const ok = fetch;
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) =>
      String(args[0]).endsWith('/activity')
        ? json({ data: [{ id: 'a2', action: 'PROJECT_COMPANIES_CHANGED', createdAt: new Date().toISOString(), meta: { added: ['Alpha Co'] }, actor: { id: 'u1', name: 'Aisha Khan' }, task: null, project: { id: 'p1', name: 'Rig Inspection' } }] })
        : ok(...args),
    ));
    renderPage();
    const verb = await screen.findByText('changed the companies of');
    expect(verb.closest('p')).toHaveTextContent('Aisha Khan changed the companies of Rig Inspection');
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
