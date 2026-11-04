import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { BoardTab } from '../components/project-dashboard/BoardTab';
import { useAuthStore } from '../stores/auth-store';
import { userStorageKey } from '../lib/user-storage';
import type { ApiProject } from '../api/projects';

vi.mock('../lib/useBoardRealtime', () => ({ useBoardRealtime: () => {} }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const project = (id: string, code: string, name: string, status = 'ACTIVE') => ({ id, code, name, description: null, clientName: null, status, priority: 'HIGH', color: '#8B1E1E', icon: null, imageUrl: null, createdAt: '', updatedAt: '' });
const PROJECTS = [project('p1', 'MICO', 'MICO360 Platform'), project('p2', 'OPS', 'Operations'), project('p3', 'OLD', 'Old Works', 'ARCHIVED')];
const task = (id: string, key: string, title: string, projectId: string, columnId: string, columnCategory: string, position = 0) =>
  ({ id, key, title, description: null, projectId, columnId, columnCategory, position, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', assignees: [] });
const COLUMNS: Record<string, unknown[]> = {
  p1: [
    { id: 'p1-todo', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
    { id: 'p1-doing', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '#C98A1B', enabled: true },
  ],
  p2: [{ id: 'p2-todo', projectId: 'p2', name: 'Ops To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }],
  p3: [{ id: 'p3-todo', projectId: 'p3', name: 'Old To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }],
};
const TASKS = [
  task('t3', 'MICO-2', 'Order rebar', 'p1', 'p1-doing', 'IN_PROGRESS'),
  task('t1', 'MICO-1', 'Pour slab B', 'p1', 'p1-todo', 'TODO', 1),
  task('t5', 'MICO-5', 'Check pumps', 'p1', 'p1-todo', 'TODO', 0),
  task('t2', 'OPS-1', 'Fleet check', 'p2', 'p2-todo', 'TODO'),
  task('t4', 'OLD-1', 'Old thing', 'p3', 'p3-todo', 'TODO'),
];

let calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
beforeEach(() => {
  calls = [];
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'UTC', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: COLUMNS[cols[1]!] ?? [] });
      if (u.includes('/members')) return json({ data: [] });
      if (method === 'PATCH' && u.includes('/move')) return json({ data: { ...TASKS[0], columnId: 'p1-todo', columnCategory: 'TODO' } });
      if (u.includes('/tasks?')) {
        const pid = new URL(u, 'http://x').searchParams.get('projectId');
        return json({ data: pid ? TASKS.filter((t) => t.projectId === pid) : TASKS });
      }
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/board']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const titles = () => screen.getAllByRole('rowheader').map((h) => h.textContent);

describe('Board page: Board | Table (1.23.0)', () => {
  it('shows the day’s tasks as a table, column then position, and remembers the choice', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'p1');
    wrap(<BoardPage />);
    await user.click(await screen.findByRole('button', { name: 'Table view' }));
    expect(await screen.findByRole('table', { name: /MICO360 Platform/ })).toBeInTheDocument();
    expect(localStorage.getItem(userStorageKey('u1', 'board.view'))).toBe('table');
    await waitFor(() => expect(titles()).toEqual([expect.stringContaining('Check pumps'), expect.stringContaining('Pour slab B'), expect.stringContaining('Order rebar')]));
    // It has its own filter bar (the board has none of its own).
    expect(screen.getByRole('searchbox', { name: 'Filter rows' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Project/ })).toBeNull();
  });

  it('All projects: a Project column, and each row’s own project’s statuses', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'all');
    localStorage.setItem(userStorageKey('u1', 'board.view'), 'table');
    wrap(<BoardPage />);
    expect(await screen.findByRole('table', { name: /All projects/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Project/ })).toBeInTheDocument();
    // An archived project's tasks aren't on All projects.
    await waitFor(() => expect(titles()).toHaveLength(4));
    expect(screen.queryByText('Old thing')).toBeNull();
    const ops = screen.getByRole('rowheader', { name: /OPS-1/ }).closest('tr')!;
    await user.click(await within(ops).findByRole('button', { name: 'Status of OPS-1: Ops To Do' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ops To Do']);
  });

  it('a project’s Board tab doesn’t take the Board page’s choice', async () => {
    localStorage.setItem(userStorageKey('u1', 'board.view'), 'table');
    wrap(<BoardTab project={PROJECTS[0] as unknown as ApiProject} />);
    expect(await screen.findByRole('button', { name: 'Board view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('a project’s Board tab: Board | Table of its own, read-only when archived', async () => {
    const user = userEvent.setup();
    wrap(<BoardTab project={PROJECTS[0] as unknown as ApiProject} readOnly="archived" />);
    await user.click(await screen.findByRole('button', { name: 'Table view' }));
    expect(localStorage.getItem(userStorageKey('u1', 'project-board.view'))).toBe('table');
    expect(localStorage.getItem(userStorageKey('u1', 'board.view'))).toBeNull();
    await screen.findByRole('table');
    expect(screen.getByText('This project is archived — reopen it first.')).toBeInTheDocument();
    await waitFor(() => expect(titles()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: /Change the title/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Status of/ })).toBeNull();
  });

  it('changes a status from the table on the board’s day', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'p1');
    localStorage.setItem(userStorageKey('u1', 'board.view'), 'table');
    wrap(<BoardPage />);
    const row = (await screen.findByRole('rowheader', { name: /MICO-2/ })).closest('tr')!;
    await user.click(await within(row).findByRole('button', { name: 'Status of MICO-2: Doing' }));
    await user.click(screen.getByRole('option', { name: 'To Do' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: expect.stringContaining('/tasks/t3/move'), body: { columnId: 'p1-todo' } }));
  });
});
