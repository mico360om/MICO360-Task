import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksPage } from './MyTasksPage';

// Counts each row's draws through its tick box (a part every row has).
const draws = new Map<string, number>();
vi.mock('../components/bulk/select-boxes', async (orig) => {
  const m = await orig<typeof import('../components/bulk/select-boxes')>();
  return {
    ...m,
    TaskSelectBox: (props: Parameters<typeof m.TaskSelectBox>[0]) => {
      draws.set(props.task.id, (draws.get(props.task.id) ?? 0) + 1);
      return m.TaskSelectBox(props);
    },
  };
});
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

beforeEach(() => {
  localStorage.clear();
  draws.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/tasks/mine')) return json({ data: TASKS });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

// 1.24.7 (Error log: "Slow to answer a click", 1.1 s): opening a task drew every row again.
describe.each(['list', 'grid'] as const)('My Tasks (%s): opening a task doesn’t draw the other rows again', (view) => {
  it('only the rows whose own props changed are drawn', async () => {
    localStorage.setItem(userStorageKey('u1', 'mytasks.view'), view);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/my-tasks']}>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Set out');
    await waitFor(() => expect(draws.get('t4')).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    draws.clear();
    await userEvent.click(screen.getByText('Set out'));
    await new Promise((r) => setTimeout(r, 50));
    expect([...draws.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
});
