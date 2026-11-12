import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksPage } from './MyTasksPage';
import { useAuthStore } from '../stores/auth-store';
import { userStorageKey } from '../lib/user-storage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const t = (id: string, key: string, title: string, priority: string, projectId = 'p1') => ({
  id, key, title, description: null, projectId, columnId: 'c1', columnCategory: 'TODO', position: 0, priority,
  startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', assignees: [{ id: 'u1', name: 'Ada Lovelace' }],
});
const TASKS = [t('t1', 'RIG-1', 'Pour the slab', 'URGENT'), t('t2', 'RIG-2', 'Set out', 'HIGH'), t('t3', 'RIG-3', 'Order steel', 'URGENT'), t('t4', 'OPS-4', 'Hire a crane', 'LOW', 'p2')];
const PROJECTS = [
  { id: 'p1', code: 'RIG', name: 'Rig 3', color: '#1E5A8B', status: 'ACTIVE', canManage: false },
  { id: 'p2', code: 'OPS', name: 'Operations', color: '#8B1E1E', status: 'ACTIVE', canManage: true },
];
let posts: { url: string; body: { taskIds: string[]; action: unknown; dryRun?: boolean } }[] = [];

beforeEach(() => {
  localStorage.clear();
  posts = [];
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && u.endsWith('/tasks/bulk/b1/undo')) return json({ data: { restored: [{ id: 't2', key: 'RIG-2', title: 'Set out', projectId: 'p1' }], skipped: [] } });
      if (init?.method === 'POST' && u.endsWith('/tasks/bulk')) {
        const body = JSON.parse(String(init.body));
        posts.push({ url: u, body });
        return json({ data: {
          action: 'status', dryRun: !!body.dryRun, total: body.taskIds.length,
          changed: body.taskIds.slice(1).map((id: string) => ({ id, key: id.toUpperCase(), title: 'T', projectId: 'p1' })),
          skipped: [{ id: body.taskIds[0], key: 'RIG-1', title: 'Pour the slab', code: 'FORBIDDEN', reason: 'You can’t move tasks in Rig 3.' }],
          undo: body.dryRun ? null : { id: 'b1', until: '2026-11-12T08:00:30.000Z' },
        } });
      }
      if (u.includes('/tasks/mine')) return json({ data: TASKS });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.endsWith('/tasks/move-targets')) return json({ data: { managesAll: false, managedProjectIds: ['p2'], projects: [] } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function show(view: 'grid' | 'list' | 'table' = 'list') {
  localStorage.setItem(userStorageKey('u1', 'mytasks.view'), view);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/my-tasks']}>
        <MyTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const box = (name: string) => screen.getByRole('checkbox', { name });

describe('My Tasks: bulk selection (owner, 10 Nov)', () => {
  it('names each box by its number and title, and says the count to screen readers', async () => {
    show();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select RIG-2 Set out' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(document.querySelector('[data-bulk-count]')).toHaveTextContent('1 task selected');
  });

  it('Shift-click selects every task between, in the list as shown', async () => {
    show();
    await screen.findByRole('checkbox', { name: 'Select RIG-1 Pour the slab' });
    // Sorted by due date (none) — the list's own order: RIG-1, RIG-2, RIG-3, OPS-4.
    const order = screen.getAllByRole('checkbox', { name: /^Select [A-Z]+-\d/ }).map((b) => b.getAttribute('aria-label'));
    const user = userEvent.setup();
    await user.click(box(order[0]!));
    await user.keyboard('{Shift>}');
    await user.click(box(order[2]!));
    await user.keyboard('{/Shift}');
    expect(screen.getAllByRole('checkbox', { name: /^Select [A-Z]+-\d/, checked: true }).map((b) => b.getAttribute('aria-label'))).toEqual(order.slice(0, 3));
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('the selection survives a filter change: the hidden ones still count and are said', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('checkbox', { name: 'Select all 4' }));
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filter by priority' }));
    await user.click(screen.getByRole('option', { name: 'Urgent' }));
    expect(screen.getByText('4 selected (2 hidden by filters)')).toBeInTheDocument();
    // "Select all 2 matching" is ticked (both shown are selected); unticking lets only those go.
    const all = screen.getByRole('checkbox', { name: 'Select all 2 matching' });
    expect(all).toBeChecked();
    await user.click(all);
    expect(screen.getByText('2 selected (2 hidden by filters)')).toBeInTheDocument();
  });

  it('a change: confirm first (the dry run), then the summary with Undo; the selection is cleared', async () => {
    const user = userEvent.setup();
    show('grid');
    await user.click(await screen.findByRole('checkbox', { name: 'Select RIG-1 Pour the slab' }));
    await user.click(box('Select RIG-2 Set out'));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    await user.click(within(bar).getByRole('button', { name: 'Status' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 2 tasks to Done?' });
    await waitFor(() => expect(dialog).toHaveTextContent('1 will be skipped: you can’t move tasks in Rig 3.'));
    expect(posts[0]!.body).toEqual({ taskIds: ['t1', 't2'], action: { type: 'status', status: 'DONE' }, dryRun: true });
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    // The bar and the dialog are gone: keyboard focus is on the summary.
    expect(await screen.findByText('1 updated · 1 not changed')).toHaveFocus();
    expect(posts[1]!.body).toEqual({ taskIds: ['t1', 't2'], action: { type: 'status', status: 'DONE' } });
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
    expect(box('Select RIG-1 Pour the slab')).not.toBeChecked();
    // "Select the 1 skipped": back as the selection, for another try.
    await user.click(screen.getByRole('button', { name: 'Select the 1 skipped' }));
    expect(box('Select RIG-1 Pour the slab')).toBeChecked();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
    // Known as before (its project): one project's Category is offered.
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Category' })).not.toHaveAttribute('aria-disabled');
    await user.keyboard('{Escape}');
    // Undo puts them back, and lets the selection go.
    await user.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(await screen.findByText('1 put back')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('Archive and Delete only when the person runs a selected task’s project', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('checkbox', { name: 'Select RIG-1 Pour the slab' }));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(box('Select OPS-4 Hire a crane'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    // Two projects: no Category.
    expect(screen.getByRole('menuitem', { name: /Category/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('the Table view’s boxes share the selection', async () => {
    const user = userEvent.setup();
    show('table');
    await screen.findByRole('table');
    await user.click(box('Select RIG-2 Set out'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
