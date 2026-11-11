import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ArchivedTasksPage } from './ArchivedTasksPage';
import { useAuthStore } from '../stores/auth-store';

// Task archive (bulk lane): a project's "Archived tasks" — anyone who sees the project may list them (read-only);
// Unarchive for administrators and the people who run it.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}
const thisYear = new Date().getUTCFullYear();
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `t${n}`, key: `RIG-${n}`, title: `Old task ${n}`, description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'DONE', position: n, priority: 'NORMAL',
  startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', archivedAt: `${thisYear}-11-03T05:00:00.000Z`, archivedById: 'u2', ...extra,
});
let archived: ReturnType<typeof row>[];
let posted: string[];
let project: Record<string, unknown>;

beforeEach(() => {
  archived = [row(12), row(7, { columnCategory: 'TODO' })];
  posted = [];
  project = { id: 'p1', code: 'RIG', name: 'Rig 3', status: 'ACTIVE', canManage: true };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && /\/tasks\/t\d+\/unarchive$/.test(u)) {
        const id = u.split('/').at(-2)!;
        posted.push(id);
        archived = archived.filter((t) => t.id !== id);
        return json({ data: { id, key: `RIG-${id.slice(1)}`, archivedAt: null } });
      }
      // tbk: bulk Unarchive from this page (review M10): the dry run, then the change.
      if (init?.method === 'POST' && u.endsWith('/tasks/bulk')) {
        const body = JSON.parse(String(init.body)) as { taskIds: string[]; dryRun?: boolean };
        const changed = archived.filter((t) => body.taskIds.includes(t.id)).map((t) => ({ id: t.id, key: t.key, title: t.title, projectId: 'p1' }));
        if (!body.dryRun) archived = archived.filter((t) => !body.taskIds.includes(t.id));
        return json({ data: { action: 'unarchive', dryRun: Boolean(body.dryRun), total: body.taskIds.length, changed, skipped: [], undo: body.dryRun ? null : { id: 'b1', until: new Date(Date.now() + 30000).toISOString() } } });
      }
      if (u.includes('archived=only')) return json({ data: archived });
      if (u.endsWith('/projects/p1')) return json({ data: project });
      if (u.includes('/users/directory')) return json({ data: [{ id: 'u2', username: 'ali', firstName: 'Ali', lastName: 'Hassan', avatarUrl: null }] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(roles: string[] = []) {
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles }, accessToken: 'at', refreshToken: 'rt' });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1/archived']}>
        <Routes>
          <Route path="/projects/:id/archived" element={<><ArchivedTasksPage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ArchivedTasksPage', () => {
  it('lists the project’s archived tasks: number, title, status, when and by whom', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Archived tasks' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Archived tasks' });
    const first = within(list).getAllByRole('listitem')[0]!;
    expect(first).toHaveTextContent('RIG-12');
    expect(first).toHaveTextContent('Old task 12');
    expect(first).toHaveTextContent('Done');
    await waitFor(() => expect(first).toHaveTextContent('Archived 3 Nov by Ali Hassan'));
    expect(screen.getByText('2 archived tasks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rig 3/ })).toHaveAttribute('href', '/projects/p1');
  });

  it('opens a task in the task panel (read-only there), with the list to step through', async () => {
    open();
    const list = await screen.findByRole('list', { name: 'Archived tasks' });
    await userEvent.click(within(list).getByRole('button', { name: /Old task 7/ }));
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1/archived?task=t7');
  });

  it('Unarchive brings one back and says so; the list goes down', async () => {
    open();
    const list = await screen.findByRole('list', { name: 'Archived tasks' });
    await userEvent.click(within(list).getByRole('button', { name: 'Unarchive RIG-12' }));
    await waitFor(() => expect(posted).toEqual(['t12']));
    expect((await screen.findByText('RIG-12 unarchived — back on its board.')).closest('[role="status"]')).not.toBeNull();
    await waitFor(() => expect(screen.queryByText('Old task 12')).toBeNull());
    expect(screen.getByText('1 archived task')).toBeInTheDocument();
  });

  it('someone who doesn’t run the project lists them read-only: no Unarchive', async () => {
    project = { ...project, canManage: false };
    open();
    const list = await screen.findByRole('list', { name: 'Archived tasks' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /^Unarchive/ })).toBeNull();
  });

  it('nothing archived: “No archived tasks.”', async () => {
    archived = [];
    open(['ADMIN']);
    expect(await screen.findByText('No archived tasks.')).toBeInTheDocument();
  });
});

// tbk: review M10 — several archived tasks are unarchived at once from here; the summary stays when the list empties.
describe('ArchivedTasksPage — bulk Unarchive', () => {
  it('tick the tasks, Unarchive, confirm: the summary (with Undo) stays when the list empties', async () => {
    open(['ADMIN']);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select all 2' }));
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    expect(within(bar).queryByRole('button', { name: 'Status' })).toBeNull();
    const more = within(bar).queryByRole('button', { name: 'More actions' });
    if (more) {
      await userEvent.click(more);
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Unarchive' }));
    } else await userEvent.click(within(bar).getByRole('button', { name: 'Unarchive' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/2 tasks will change\./);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('2 unarchived')).toBeInTheDocument();
    expect(await screen.findByText('No archived tasks.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeInTheDocument();
  });
});
