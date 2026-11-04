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
const t = (id: string, key: string, title: string, priority: string, dueDate: string | null, projectId = 'p1') => ({
  id, key, title, description: null, projectId, columnId: projectId === 'p1' ? 'c1' : 'o1', columnCategory: 'TODO', position: 0, priority,
  startDate: null, dueDate, progress: 40, completedAt: null, createdAt: '', updatedAt: '', assignees: [{ id: 'u1', name: 'Ada Lovelace' }],
});
const PROJECTS = [
  { id: 'p1', code: 'FIN', name: 'Finance', color: '#1E5A8B', status: 'ACTIVE' },
  { id: 'p2', code: 'OLD', name: 'Old works', color: '#8B1E1E', status: 'ARCHIVED' },
];

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/tasks/mine')) return json({ data: [t('t1', 'FIN-2', 'Later work', 'URGENT', '2026-09-20'), t('t2', 'FIN-3', 'Sooner work', 'LOW', '2026-09-06'), t('t3', 'OLD-4', 'Archived work', 'HIGH', null, 'p2')] });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.includes('/projects/p1/columns')) return json({ data: [{ id: 'c1', projectId: 'p1', name: 'Queue', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }] });
      if (u.includes('/projects/p2/columns')) return json({ data: [{ id: 'o1', projectId: 'p2', name: 'Old queue', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/my-tasks']}>
        <MyTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const titles = () => screen.getAllByRole('rowheader').map((h) => h.textContent);

describe('My Tasks: Grid | List | Table (1.23.0)', () => {
  it('Table is a third view, remembered as before', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Table view' }));
    expect(screen.getByRole('table', { name: 'My tasks' })).toBeInTheDocument();
    expect(localStorage.getItem(userStorageKey('u1', 'mytasks.view'))).toBe('table');
    // Project is a column here; the page's usual order (due date, undated last).
    expect(screen.getByRole('columnheader', { name: /Project/ })).toBeInTheDocument();
    expect(titles()).toEqual([expect.stringContaining('Sooner work'), expect.stringContaining('Later work'), expect.stringContaining('Archived work')]);
    // Grid and List stay as they are.
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List view' })).toBeInTheDocument();
  });

  it('a header click is the page’s Sort: the menu follows it', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'mytasks.view'), 'table');
    show();
    await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: /Due date/ })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(screen.getByRole('columnheader', { name: /Title/ })).getByRole('button'));
    expect(screen.getByRole('button', { name: 'Sort tasks' })).toHaveTextContent('Title (A–Z)');
    expect(titles()).toEqual([expect.stringContaining('Archived work'), expect.stringContaining('Later work'), expect.stringContaining('Sooner work')]);
    await user.click(within(screen.getByRole('columnheader', { name: /Title/ })).getByRole('button'));
    expect(screen.getByRole('button', { name: 'Sort tasks' })).toHaveTextContent('Title (Z–A)');
    expect(titles()[0]).toContain('Sooner work');
    // Then back to the page's usual order.
    await user.click(within(screen.getByRole('columnheader', { name: /Title/ })).getByRole('button'));
    expect(screen.getByRole('button', { name: 'Sort tasks' })).toHaveTextContent('Due date');
  });

  it('the page’s own filters narrow the table (no second filter bar)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'mytasks.view'), 'table');
    show();
    await screen.findByRole('table');
    expect(screen.queryByRole('searchbox', { name: 'Filter rows' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filter by priority' }));
    await user.click(screen.getByRole('option', { name: 'Urgent' }));
    expect(titles()).toEqual([expect.stringContaining('Later work')]);
  });

  it('keeps the selection boxes and the bulk bar', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'mytasks.view'), 'table');
    show();
    await screen.findByRole('table');
    await user.click(screen.getByRole('checkbox', { name: 'Select FIN-2' }));
    expect(await screen.findByText(/1 selected/i)).toBeInTheDocument();
  });

  it('a task of an archived project is to look at; the others can be changed', async () => {
    localStorage.setItem(userStorageKey('u1', 'mytasks.view'), 'table');
    show();
    await screen.findByRole('table');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change the title of FIN-2: Later work' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Change the title of OLD-4/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Archived work' })).toBeInTheDocument();
  });

  it('a saved view keeps the table’s columns', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'mytasks.view'), 'table');
    show();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('checkbox', { name: 'Start date' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Filter by priority' }));
    await user.click(screen.getByRole('option', { name: 'Urgent' }));
    await user.click(screen.getByRole('button', { name: /Save view/ }));
    await user.type(screen.getByPlaceholderText('Name this view…'), 'Urgent dated{Enter}');
    // Hide the column again, then apply the view: it comes back.
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('checkbox', { name: 'Start date' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('columnheader', { name: /Start date/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Urgent dated' }));
    expect(screen.getByRole('columnheader', { name: /Start date/ })).toBeInTheDocument();
  });
});
