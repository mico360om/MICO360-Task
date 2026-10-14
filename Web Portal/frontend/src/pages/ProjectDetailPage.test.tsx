import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProjectDetailPage } from './ProjectDetailPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECT = { id: 'p1', code: 'MICO', name: 'MICO Platform', description: 'Desc', clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', ownerId: null, createdAt: '', updatedAt: '' };
const COLUMNS = [
  { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#111', enabled: true },
  { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#222', enabled: true },
];
const task = (id: string, extra: Record<string, unknown>) => ({
  id, key: id.toUpperCase(), title: `Task ${id}`, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra,
});

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  // A project MANAGER who is not an admin.
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@b.c', username: 'manager', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T10:00:00Z')); // 14:00 on 30 Sep in Muscat
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
    if (u.includes('/members')) return json({ data: [{ id: 'u1', username: 'manager', email: '', firstName: 'Mona', lastName: 'M', role: 'MANAGER' }] });
    if (u.endsWith('/users/directory')) return json({ data: [
      { id: 'u1', username: 'manager', firstName: 'Mona', lastName: 'M', avatarUrl: null },
      { id: 'u7', username: 'sara', firstName: 'Sara', lastName: 'K', avatarUrl: null },
    ] });
    if (u.endsWith('/users')) return json({ error: { code: 'FORBIDDEN', message: 'Admins only' } }, 403);
    if (u.includes('/columns')) return json({ data: COLUMNS });
    if (u.includes('/tasks')) return json({ data: [
      task('t1', { dueDate: '2026-09-30T00:00:00.000Z' }), // due today → not overdue
      task('t2', { dueDate: '2026-09-29T00:00:00.000Z' }), // yesterday → overdue
      task('t3', { dueDate: '2026-09-01T00:00:00.000Z', columnId: 'c2', columnCategory: 'DONE' }), // done → never overdue
    ] });
    return json({ data: PROJECT });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/p1']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ProjectDetailPage', () => {
  it('lets a project manager add members, picking from the people directory', async () => {
    renderPage();
    await screen.findByText('MICO Platform');
    await userEvent.click(screen.getByRole('tab', { name: /team/i }));
    const picker = await screen.findByLabelText(/add a member/i);
    expect(within(picker).getByRole('option', { name: 'Sara K' })).toBeInTheDocument();
    expect(calls.some((u) => u.endsWith('/users'))).toBe(false);
  });

  it('offers editing the project and its owner only to an admin — the server refuses them to anyone else', async () => {
    // A project manager (the default user here) may manage the team, not the project's own details.
    renderPage();
    await screen.findByRole('heading', { name: 'MICO Platform' });
    expect(screen.queryByRole('button', { name: /edit project/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /project owner/i })).not.toBeInTheDocument();
    expect(screen.getByText('No owner')).toBeInTheDocument(); // the owner is still shown, as text
  });

  it('shows the project picture in the header: its icon on its colour, or its initials', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'MICO Platform' });
    const header = screen.getByRole('img', { name: 'MICO Platform' });
    expect(header).toHaveTextContent('MP'); // no icon or picture saved yet → initials on the project colour
    expect(header).toHaveStyle({ background: '#8B1E1E' });
  });

  it('lets an admin open the edit form, filled in with the project', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@b.c', username: 'manager', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /edit project/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('MICO Platform');
    expect(within(dialog).getByLabelText(/^code/i)).toHaveValue('MICO');
    expect(screen.getByRole('button', { name: /project owner/i })).toBeInTheDocument();
  });

  it('opens the board of THIS project', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /open board/i });
    expect(link).toHaveAttribute('href', '/board?project=p1');
  });

  it('counts overdue by company calendar day and never counts finished tasks', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Overdue').previousElementSibling).toHaveTextContent('1'));
    expect(screen.getByText('Completed').previousElementSibling).toHaveTextContent('1');
  });

  it('a project that does not exist gets a clear "not found" page, not a broken one', async () => {
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (/\/projects\/p1$/.test(u)) return json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } }, 404);
      return base(url, init);
    }));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Project not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to projects/i })).toHaveAttribute('href', '/projects');
    // Nothing of the empty page shell (tabs, zero counters) is shown, and there is nothing to retry.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('a project that fails to load says so and offers to try again', async () => {
    const base = fetch;
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (/\/projects\/p1$/.test(u) && fail) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
      return base(url, init);
    }));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Couldn’t load this project' })).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'MICO Platform' })).toBeInTheDocument();
  });

  it('shows placeholders, not zero counters, while the project and its tasks are loading', async () => {
    const base = fetch;
    const never = new Promise<Response>(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (/\/projects\/p1$/.test(u) || u.includes('/tasks')) return never;
      return base(url, init);
    }));
    renderPage();
    expect(await screen.findByLabelText('Loading project')).toBeInTheDocument();
    // All five tiles (total, completed, in progress, overdue, completion) wait for the data.
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
