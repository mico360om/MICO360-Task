import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { useAuthStore } from '../stores/auth-store';
import { clearQueue, localStorageQueueStore } from '../lib/offline-queue';
import { userStorageKey } from '../lib/user-storage';
import type { KanbanColumnData } from '../components/KanbanColumn';

// The rooms the board joins, instead of opening a real socket.
let rooms: unknown = null;
vi.mock('../lib/useBoardRealtime', () => ({
  useBoardRealtime: (projects: unknown) => {
    rooms = projects;
  },
}));

// A stand-in board: lists each column's cards, and buttons that do what a drag or a "+" would.
vi.mock('../components/KanbanBoard', () => ({
  KanbanBoard: ({ columns, onMove, onAddTask }: { columns: KanbanColumnData[]; onMove: (key: string, to: string, index: number) => void; onAddTask?: (id: string) => void }) => (
    <div>
      {columns.map((c) => (
        <section key={c.id} aria-label={c.name}>
          {c.tasks.map((t) => (
            <div key={t.key} data-testid="card">
              {t.key} · {t.project?.name ?? 'no project'}
              {columns.map((to) => (to.id === c.id ? null : <button key={to.id} onClick={() => onMove(t.key, to.id, 0)}>{`Move ${t.key} to ${to.name}`}</button>))}
            </div>
          ))}
          {onAddTask ? <button onClick={() => onAddTask(c.id)}>{`Add a task to ${c.name}`}</button> : null}
        </section>
      ))}
    </div>
  ),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const project = (id: string, code: string, name: string, status = 'ACTIVE') => ({ id, code, name, description: null, clientName: null, status, priority: 'HIGH', color: '#8B1E1E', icon: null, imageUrl: null, createdAt: '', updatedAt: '' });
const PROJECTS = [project('p1', 'MICO', 'MICO360 Platform'), project('p2', 'OPS', 'Operations'), project('p3', 'OLD', 'Old Works', 'ARCHIVED')];
const task = (id: string, key: string, projectId: string, columnId: string, columnCategory: string, dueDate: string | null = null) =>
  ({ id, key, title: key, description: null, projectId, columnId, columnCategory, position: 0, priority: 'NORMAL', startDate: null, dueDate, progress: 0, completedAt: null, createdAt: '', updatedAt: '' });
const COLUMNS: Record<string, unknown[]> = {
  p1: [
    { id: 'p1-todo', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
    { id: 'p1-doing', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '#C98A1B', enabled: true },
  ],
  // Operations has no In Progress column.
  p2: [{ id: 'p2-todo', projectId: 'p2', name: 'Ops To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }],
};

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let tasks: ReturnType<typeof task>[] = [];

beforeEach(() => {
  calls = [];
  rooms = null;
  tasks = [
    task('t1', 'MICO-1', 'p1', 'p1-todo', 'TODO', '2026-10-25'),
    task('t2', 'OPS-1', 'p2', 'p2-todo', 'TODO', '2026-10-22'),
    task('t3', 'MICO-2', 'p1', 'p1-doing', 'IN_PROGRESS'),
    task('t4', 'OLD-1', 'p3', 'p3-todo', 'TODO'),
  ];
  clearQueue(localStorageQueueStore);
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (method === 'PATCH' && u.includes('/move')) {
        // The server moves it: the task now sits in that column, of that column's kind.
        const id = /\/tasks\/([^/]+)\/move/.exec(u)![1];
        const columnId = String(JSON.parse(String(init!.body)).columnId);
        const col = Object.values(COLUMNS).flat().find((c) => (c as { id: string }).id === columnId) as { category: string };
        tasks = tasks.map((t) => (t.id === id ? { ...t, columnId, columnCategory: col.category } : t));
        return json({ data: tasks.find((t) => t.id === id) });
      }
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: COLUMNS[cols[1]!] ?? [] });
      if (u.includes('/members')) return json({ data: [] });
      if (u.includes('/tasks/carry-forward')) return json({ data: { carried: 0 } });
      if (u.includes('/tasks?') || u.endsWith('/tasks')) {
        return json({ data: tasks });
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

function renderPage(path = '/board?project=all') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const column = (name: string) => screen.getByRole('region', { name });
const cardsIn = (name: string) => within(column(name)).queryAllByTestId('card').map((c) => c.textContent?.split(' · ')[0]);

describe('Kanban Board: All projects', () => {
  it('shows every open project’s tasks under the six statuses, each card naming its project', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'In Progress' });
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Backlog', 'To Do', 'In Progress', 'Blocked', 'Review', 'Done']);
    await waitFor(() => expect(cardsIn('To Do')).toEqual(['OPS-1', 'MICO-1'])); // by due date; the archived project's task isn't here
    expect(cardsIn('In Progress')).toEqual(['MICO-2']);
    expect(within(column('To Do')).getAllByTestId('card')[0]).toHaveTextContent('Operations');
    // One request for every project's tasks on the day (no project named), and live updates from each open project.
    const taskLists = calls.filter((c) => /\/tasks\?boardDate=/.test(c.url));
    expect(taskLists.length).toBeGreaterThan(0);
    expect(taskLists.every((c) => !c.url.includes('projectId='))).toBe(true);
    expect(rooms).toEqual(['p1', 'p2']);
    expect(screen.queryByRole('button', { name: /manage columns/i })).not.toBeInTheDocument();
  });

  it('offers All projects in the project picker and remembers the choice', async () => {
    renderPage('/board');
    await userEvent.click(await screen.findByRole('button', { name: 'Select project' }));
    await userEvent.click(await screen.findByRole('option', { name: /All projects/ }));
    await screen.findByRole('region', { name: 'Review' });
    expect(localStorage.getItem(userStorageKey('u1', 'board.projectId'))).toBe('all');
  });

  it('moves a card to the status it is dropped on, in its own project’s column of that kind', async () => {
    renderPage();
    await waitFor(() => expect(cardsIn('To Do')).toContain('MICO-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Move MICO-1 to In Progress' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/tasks/t1/move'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/tasks/t1/move'))!.body).toEqual({ columnId: 'p1-doing' });
    expect(cardsIn('In Progress')).toContain('MICO-1');
  });

  it('keeps a card where it was when its project has no column of that kind, and says so', async () => {
    renderPage();
    await waitFor(() => expect(cardsIn('To Do')).toContain('OPS-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Move OPS-1 to In Progress' }));
    expect(await screen.findByText(/Operations has no “In Progress” column, so OPS-1 stayed where it was\./)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(cardsIn('To Do')).toContain('OPS-1');
  });

  it('filters the board to chosen projects, remembering what was left out', async () => {
    renderPage();
    await waitFor(() => expect(cardsIn('To Do')).toEqual(['OPS-1', 'MICO-1']));
    await userEvent.click(screen.getByRole('button', { name: /Projects: all/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Operations' }));
    expect(cardsIn('To Do')).toEqual(['MICO-1']);
    expect(screen.getByRole('button', { name: /Projects: 1 of 2/i })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(userStorageKey('u1', 'board.hiddenProjects')) ?? '[]')).toEqual(['p2']);
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(cardsIn('To Do')).toEqual(['OPS-1', 'MICO-1']);
  });

  it('starts a new task from a status in that kind of column, with the project to choose', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a task to In Progress' }));
    const dialog = await screen.findByRole('dialog', { name: /new task/i });
    expect(within(dialog).getByRole('button', { name: 'Project' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Column' })).toHaveTextContent('Doing'));
  });
});
