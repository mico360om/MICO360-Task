import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { useAuthStore } from '../stores/auth-store';
import { userStorageKey } from '../lib/user-storage';

// Capture the board's live-event handler instead of opening a real socket.
let liveHandler: ((event: string, payload?: unknown) => void) | null = null;
vi.mock('../lib/useBoardRealtime', () => ({
  useBoardRealtime: (_projectId: string | undefined, cb: (event: string, payload?: unknown) => void) => {
    liveHandler = cb;
  },
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const PROJECTS = [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', canManage: true, createdAt: '', updatedAt: '' }];
const task = (id: string, key: string, title: string, columnId = 'c-todo') => ({ id, key, title, description: null, projectId: 'p1', columnId, position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', assignees: [] });

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (u.includes('/columns')) {
        return json({ data: [
          { id: 'c-todo', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
          { id: 'c-ip', projectId: 'p1', name: 'In Progress', category: 'IN_PROGRESS', position: 1, color: '#C98A1B', enabled: true },
        ] });
      }
      if (u.includes('/tasks/move-targets')) return json({ data: { managesAll: false, managedProjectIds: ['p1'], projects: [] } });
      if (u.includes('/tasks')) {
        return json({ data: [task('t1', 'MICO-1', 'Prepare report'), task('t2', 'MICO-2', 'Check pumps'), task('t3', 'MICO-3', 'Paint rails'), task('t4', 'MICO-4', 'Order valves', 'c-ip')] });
      }
      if (u.includes('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/board?project=p1']}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}
const card = (key: string) => document.querySelector<HTMLElement>(`[data-card-key="${key}"]`)!;

describe('the Kanban board: Select mode (bulk changes)', () => {
  it('Select puts a box on each card and column, and dragging waits meanwhile', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Prepare report');
    expect(card('MICO-1')).toHaveAttribute('aria-roledescription', 'sortable');
    expect(screen.queryByRole('checkbox', { name: /^Select MICO-1/ })).toBeNull();
    const select = screen.getByRole('button', { name: 'Select' });
    expect(select).toHaveAttribute('aria-pressed', 'false');
    await user.click(select);
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: 'Select MICO-1 Prepare report' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select every task in To Do' })).toBeInTheDocument();
    // Not draggable now: a plain button that opens the task.
    expect(card('MICO-1')).not.toHaveAttribute('aria-roledescription');
    // The box isn't inside the card.
    expect(card('MICO-1').contains(screen.getByRole('checkbox', { name: 'Select MICO-1 Prepare report' }))).toBe(false);
  });

  it('Shift-click selects a range within the column; a column’s box selects its cards', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Prepare report');
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select MICO-1 Prepare report' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select MICO-3 Paint rails' }));
    await user.keyboard('{/Shift}');
    expect(screen.getByRole('checkbox', { name: 'Select MICO-2 Check pumps' })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('3 selected');
    expect(screen.getByRole('checkbox', { name: 'Select every task in To Do' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Select every task in In Progress' }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('4 selected');
    await user.click(screen.getByRole('checkbox', { name: 'Select every task in To Do' }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
  });

  it('Escape leaves Select mode and lets the selection go', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Prepare report');
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select MICO-2 Check pumps' }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Select MICO-/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
    expect(card('MICO-1')).toHaveAttribute('aria-roledescription', 'sortable');
  });

  it('the board’s Table view has the boxes and "Select all 4"', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'board.view'), 'table');
    renderPage();
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('checkbox', { name: 'Select all 4' }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('4 selected');
  });

  it('a bulk change’s live event ({ bulk, ids }) refreshes the board and each task named (an open task panel)', async () => {
    const qc = renderPage();
    await screen.findByText('Prepare report');
    const spy = vi.spyOn(qc, 'invalidateQueries');
    act(() => liveHandler?.('task:updated', { bulk: true, ids: ['t1', 't4'] }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['task', 't4'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['task', 't1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['board', 'p1'] });
  });
});
