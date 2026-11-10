import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import type { KanbanBoardProps } from '../components/KanbanBoard';
import { useAuthStore } from '../stores/auth-store';
import { userStorageKey } from '../lib/user-storage';

// Board search (10 Nov): dragging still works while searching. The real board can't be dragged in jsdom,
// so this one hands over what the page gives it (its columns, onMove, onReorder).
let board: KanbanBoardProps | null = null;
let boardRenders = 0;
vi.mock('../components/KanbanBoard', () => ({
  KanbanBoard: (props: KanbanBoardProps) => {
    board = props;
    boardRenders += 1;
    return <div data-testid="board">{props.columns.map((c) => `${c.id}:${c.tasks.map((t) => t.key).join(',')}`).join('|')}</div>;
  },
}));
vi.mock('../lib/useBoardRealtime', () => ({ useBoardRealtime: () => {} }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const PROJECTS = [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', icon: null, imageUrl: null, createdAt: '', updatedAt: '' }];
const COLUMNS = [
  { id: 'todo', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '', enabled: true },
  { id: 'doing', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '', enabled: true },
];
const task = (id: string, key: string, title: string, columnId: string, position: number) => ({
  id, key, title, description: null, projectId: 'p1', columnId, columnCategory: columnId === 'todo' ? 'TODO' : 'IN_PROGRESS', position, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', assignees: [], tags: [],
});
const TASKS = [
  task('t1', 'MICO-1', 'Pump overhaul', 'todo', 0),
  task('t2', 'MICO-2', 'Crane hire', 'doing', 0),
  task('t3', 'MICO-3', 'Pump spares', 'doing', 1),
  task('t4', 'MICO-4', 'Fence repair', 'doing', 2),
];
let calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];

beforeEach(() => {
  board = null;
  calls = [];
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'p1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'UTC', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (u.includes('/columns')) return json({ data: COLUMNS });
      if (u.includes('/members')) return json({ data: [] });
      if (method === 'PATCH' && u.endsWith('/tasks/t1/move')) return json({ data: { ...TASKS[0], columnId: 'doing' } });
      if (u.includes('/tasks?')) return json({ data: TASKS });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/board']}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Kanban board search: typing', () => {
  it('review I1: keys typed quickly don’t redraw the board each time — only once the words are read (a big board stays quick)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('board')).toHaveTextContent('doing:MICO-2,MICO-3,MICO-4'));
    const before = boardRenders;
    await user.type(screen.getByRole('searchbox', { name: 'Search this board' }), 'pump spares');
    await waitFor(() => expect(screen.getByTestId('board')).toHaveTextContent('todo:|doing:MICO-3'));
    // The words read once (and the address following them): never one draw per key (11 keys).
    expect(boardRenders - before).toBeLessThanOrEqual(3);
  });
});

describe('Kanban board search: dragging', () => {
  it('a card dropped among the cards found lands in its place in the whole column (the cards not shown keep theirs)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('board')).toHaveTextContent('doing:MICO-2,MICO-3,MICO-4'));
    expect(board?.onReorder).toBeTypeOf('function');
    await user.type(screen.getByRole('searchbox', { name: 'Search this board' }), 'pump');
    await waitFor(() => expect(screen.getByTestId('board')).toHaveTextContent('todo:MICO-1|doing:MICO-3'));
    // A column's order isn't set from the cards found (some are hidden), as with the company filter.
    expect(board?.onReorder).toBeUndefined();
    // MICO-1 dropped above MICO-3 (the first card shown in Doing): before MICO-3 in the whole column, after MICO-2.
    await act(async () => board!.onMove!('MICO-1', 'doing', 0));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' || (c.url.includes('/reorder') && c.method !== 'GET'))).toBe(true));
    const reorder = calls.find((c) => c.url.includes('/reorder'));
    expect(reorder?.body).toEqual({ orderedIds: ['t2', 't1', 't3', 't4'] });
    expect(calls.find((c) => c.url.endsWith('/tasks/t1/move'))?.body).toMatchObject({ columnId: 'doing' });
  });
});
