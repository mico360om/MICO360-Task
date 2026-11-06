import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { useAuthStore } from '../stores/auth-store';
import { clearQueue, localStorageQueueStore } from '../lib/offline-queue';
import { userStorageKey } from '../lib/user-storage';
import type { KanbanColumnData } from '../components/KanbanColumn';
import type { ApiTask } from '../api/tasks';

// Kanban Board: Monthly View (owner, 6 Nov; design calls 7 Nov). Today is Saturday 7 Nov 2026 in Muscat.
vi.mock('../lib/useBoardRealtime', () => ({ useBoardRealtime: () => {} }));

// A stand-in board: each column's cards with their month line, and buttons that do what a drag would.
vi.mock('../components/KanbanBoard', () => ({
  KanbanBoard: ({ columns, onMove, onReorder }: { columns: KanbanColumnData[]; onMove?: (key: string, to: string, index: number) => void; onReorder?: unknown }) => (
    <div data-testid="kanban" data-reorder={onReorder ? 'on' : 'off'}>
      {columns.map((c) => (
        <section key={c.id} aria-label={c.name}>
          {c.tasks.map((t) => (
            <div key={t.key} data-testid="card">
              {t.key} · {t.dateLine?.text ?? 'no line'}
              {t.dateLine?.overdue ? ' · red' : ''}
              {onMove
                ? columns.map((to) =>
                    to.id === c.id ? null : (
                      <span key={to.id}>
                        <button onClick={() => onMove(t.key, to.id, 0)}>{`Move ${t.key} to ${to.name}`}</button>
                        <button onClick={() => onMove(t.key, to.id, 1)}>{`Move ${t.key} to ${to.name} at 1`}</button>
                      </span>
                    ),
                  )
                : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  ),
}));

// A stand-in New task form: says which board day it was given, and "creates" the task the test names.
let created: Partial<ApiTask> = {};
vi.mock('../components/task-form/TaskFormDialog', () => ({
  TaskFormDialog: ({ boardDate, onCreated, onClose }: { boardDate?: string; onCreated?: (t: ApiTask) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="New task">
      <p>board day: {boardDate ?? 'none'}</p>
      <button onClick={() => { onCreated?.(created as ApiTask); onClose(); }}>Fake create</button>
    </div>
  ),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const project = (id: string, code: string, name: string, status = 'ACTIVE') => ({ id, code, name, description: null, clientName: null, status, priority: 'HIGH', color: '#8B1E1E', icon: null, imageUrl: null, createdAt: '', updatedAt: '' });
const PROJECTS = [project('p1', 'MICO', 'MICO360 Platform'), project('p2', 'OPS', 'Operations'), project('p3', 'OLD', 'Old Works', 'ARCHIVED')];
const COLUMNS = (pid: string) => [
  { id: `${pid}-todo`, projectId: pid, name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
  { id: `${pid}-doing`, projectId: pid, name: 'In Progress', category: 'IN_PROGRESS', position: 1, color: '#C98A1B', enabled: true },
  { id: `${pid}-done`, projectId: pid, name: 'Done', category: 'DONE', position: 2, color: '#2E7D32', enabled: true },
];
const day = (key: string) => `${key}T00:00:00.000Z`;
const task = (id: string, key: string, extra: Partial<ApiTask> = {}) =>
  ({ id, key, title: key, description: null, projectId: 'p1', columnId: 'p1-todo', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra }) as ApiTask;

/** What the server sends for each month (its rule already applied; undated=true adds MICO-3). */
let MONTHS: Record<string, ApiTask[]> = {};
type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
/** Moves never answer (the board shows its own optimistic move). */
let hangMoves = false;
const ext = (company: string) => ({ count: 1, name: `Someone at ${company}`, company, names: [`Someone at ${company}`], companies: [company] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-07T08:00:00.000Z'));
  calls = [];
  created = {};
  hangMoves = false;
  MONTHS = {
    '2026-11': [
      task('t1', 'MICO-1', { startDate: day('2026-11-05'), dueDate: day('2026-11-20'), externalSummary: ext('OXY') }),
      task('t2', 'MICO-2', { startDate: day('2026-10-01'), dueDate: day('2026-10-30') }),
      task('t3', 'MICO-3', { externalSummary: ext('OXY') }),
      task('t10', 'MICO-7', { externalSummary: ext('PDO') }),
      task('t11', 'OPS-2', { projectId: 'p2', columnId: 'p2-todo' }),
      task('t4', 'MICO-4', { columnId: 'p1-done', columnCategory: 'DONE', completedAt: '2026-11-03T08:00:00.000Z' }),
      task('t7', 'OPS-1', { projectId: 'p2', columnId: 'p2-todo', dueDate: day('2026-11-25') }),
      task('t8', 'OLD-1', { projectId: 'p3', columnId: 'p3-todo', dueDate: day('2026-11-26') }),
    ],
    '2026-12': [task('t5', 'MICO-5', { dueDate: day('2026-12-18') })],
    '2026-10': [task('t6', 'MICO-6', { dueDate: day('2026-10-20') }), task('t3', 'MICO-3')],
    // In Progress holds A, an undated U, then B (by position); X waits in To Do.
    '2027-01': [
      task('a1', 'MICO-11', { columnId: 'p1-doing', columnCategory: 'IN_PROGRESS', position: 0, dueDate: day('2027-01-10') }),
      task('u1', 'MICO-12', { columnId: 'p1-doing', columnCategory: 'IN_PROGRESS', position: 1 }),
      task('b1', 'MICO-13', { columnId: 'p1-doing', columnCategory: 'IN_PROGRESS', position: 2, dueDate: day('2027-01-12') }),
      task('x1', 'MICO-14', { dueDate: day('2027-01-15') }),
    ],
  };
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
        if (hangMoves) return new Promise<Response>(() => {});
        const id = /\/tasks\/([^/]+)\/move/.exec(u)![1]!;
        const columnId = String(JSON.parse(String(init!.body)).columnId);
        const category = COLUMNS(columnId.split('-')[0]!).find((c) => c.id === columnId)!.category;
        const all = Object.values(MONTHS).flat();
        const before = all.find((t) => t.id === id)!;
        const moved = { ...before, columnId, columnCategory: category, completedAt: category === 'DONE' ? new Date().toISOString() : null };
        for (const m of Object.keys(MONTHS)) MONTHS[m] = MONTHS[m]!.map((t) => (t.id === id ? moved : t));
        return json({ data: moved });
      }
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: COLUMNS(cols[1]!) });
      if (u.includes('/members')) return json({ data: [] });
      if (u.includes('/tasks/carry-forward')) return json({ data: { carried: 0 } });
      if (u.endsWith('/users/me/preferences')) return json({ data: { timeZone: null, weekStart: null, myProjectsOnly: false } });
      if (u.includes('/tasks')) {
        const q = new URL(u, 'http://x').searchParams;
        const month = q.get('month');
        const pid = q.get('projectId');
        const rows = month ? MONTHS[month] ?? [] : [task('t1', 'MICO-1')];
        return json({ data: rows.filter((t) => !pid || t.projectId === pid) });
      }
      if (u.includes('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Where() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="where">{loc.pathname + loc.search}</p>
      {/* The sidebar's "Kanban Board" link, for the page already open. */}
      <button type="button" onClick={() => navigate('/board?project=p1')}>Sidebar board link</button>
    </>
  );
}
function renderPage(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <BoardPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const where = () => screen.getByTestId('where').textContent ?? '';
const card = (key: string) => screen.getAllByTestId('card').find((c) => c.textContent?.startsWith(`${key} `));
const monthAsks = () => calls.filter((c) => c.method === 'GET' && /\/tasks\?/.test(c.url) && c.url.includes('month=')).map((c) => c.url.slice(c.url.indexOf('/tasks')));

describe('Kanban Board: Day | Month', () => {
  it('the day board is as it was; Month shows the month bar, puts the month in the address and asks for it', async () => {
    renderPage('/board?project=p1');
    await screen.findByRole('region', { name: 'To Do' });
    expect(screen.getByRole('button', { name: 'Day view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Board date')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Month view' }));
    expect(await screen.findByRole('group', { name: 'Month: November 2026' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Board date')).not.toBeInTheDocument();
    await waitFor(() => expect(where()).toContain('month=2026-11'));
    await waitFor(() => expect(monthAsks()).toContain('/tasks?month=2026-11&undated=true&projectId=p1'));
    // Month never asks for a board day.
    expect(monthAsks().every((u) => !u.includes('boardDate'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Day view' }));
    expect(await screen.findByLabelText('Board date')).toBeInTheDocument();
    await waitFor(() => expect(where()).not.toContain('month='));
  });

  it('a ?month= link opens that month', async () => {
    renderPage('/board?project=p1&month=2026-12');
    expect(await screen.findByRole('group', { name: 'Month: December 2026' })).toBeInTheDocument();
    await waitFor(() => expect(card('MICO-5')).toBeTruthy());
    expect(card('MICO-5')!.textContent).toContain('Due 18 Dec');
  });

  it('a ?month= that isn’t a month opens this month, and the address is put right', async () => {
    renderPage('/board?project=p1&month=2026-13');
    expect(await screen.findByRole('group', { name: 'Month: November 2026' })).toBeInTheDocument();
    await waitFor(() => expect(where()).toContain('month=2026-11'));
  });

  it('is remembered for the person on this device, the page’s own choice', async () => {
    const first = renderPage('/board?project=p1&month=2026-12');
    await screen.findByRole('group', { name: 'Month: December 2026' });
    await waitFor(() => expect(localStorage.getItem(userStorageKey('u1', 'board.month'))).toBe('2026-12'));
    expect(localStorage.getItem(userStorageKey('u1', 'board.period'))).toBe('month');
    first.unmount();
    renderPage('/board?project=p1');
    expect(await screen.findByRole('group', { name: 'Month: December 2026' })).toBeInTheDocument();
    await waitFor(() => expect(where()).toContain('month=2026-12'));
  });

  it('previous and next month, the month and year selectors, and This month', async () => {
    renderPage('/board?project=p1&month=2026-11');
    await screen.findByRole('group', { name: 'Month: November 2026' });
    expect(screen.queryByRole('button', { name: 'This month' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('group', { name: 'Month: December 2026' })).toBeInTheDocument();
    await waitFor(() => expect(where()).toContain('month=2026-12'));
    await waitFor(() => expect(monthAsks()).toContain('/tasks?month=2026-12&undated=true&projectId=p1'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Month' }), 'March');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '2027');
    expect(await screen.findByRole('group', { name: 'Month: March 2027' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('group', { name: 'Month: February 2027' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(await screen.findByRole('group', { name: 'Month: November 2026' })).toBeInTheDocument();
    await waitFor(() => expect(where()).toContain('month=2026-11'));
  });
});

describe('Kanban Board: the month’s cards', () => {
  it('each card shows its dates; carried-over ones are marked; the ones without dates wait behind “No date (1)”', async () => {
    renderPage('/board?project=p1&month=2026-11');
    await waitFor(() => expect(card('MICO-1')).toBeTruthy());
    expect(card('MICO-1')!.textContent).toContain('5–20 Nov');
    expect(card('MICO-2')!.textContent).toContain('Overdue · from Oct · red');
    expect(card('MICO-4')!.textContent).toContain('Done 3 Nov');
    expect(card('MICO-3')).toBeUndefined();
    const chip = screen.getByRole('button', { name: 'No date (2)' });
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(card('MICO-3')!.textContent).toContain('No date');
  });

  it('dragging changes the status in its own column move — never its dates', async () => {
    renderPage('/board?project=p1&month=2026-11');
    await waitFor(() => expect(card('MICO-1')).toBeTruthy());
    await userEvent.click(within(card('MICO-1')!).getByRole('button', { name: 'Move MICO-1 to In Progress' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/tasks/t1/move'))).toBe(true));
    const move = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/tasks/t1/move'))!;
    expect(move.body).toMatchObject({ columnId: 'p1-doing' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'In Progress' })).getByRole('button', { name: 'Move MICO-1 to To Do' })).toBeInTheDocument());
    expect(card('MICO-1')!.textContent).toContain('5–20 Nov');
  });

  it('finishing a task while looking at another month says where it went, with a link there', async () => {
    renderPage('/board?project=p1&month=2026-10');
    await waitFor(() => expect(card('MICO-6')).toBeTruthy());
    await userEvent.click(within(card('MICO-6')!).getByRole('button', { name: 'Move MICO-6 to Done' }));
    expect(await screen.findByText('Moved — it’s in Nov now.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show November 2026' }));
    expect(await screen.findByRole('group', { name: 'Month: November 2026' })).toBeInTheDocument();
    expect(screen.queryByText('Moved — it’s in Nov now.')).not.toBeInTheDocument();
  });

  it('New task in the month view: today’s defaults (no board day); saved outside the month, it says where, with a link', async () => {
    renderPage('/board?project=p1&month=2026-11');
    await waitFor(() => expect(card('MICO-1')).toBeTruthy());
    created = task('t9', 'MICO-9', { startDate: day('2026-12-01'), dueDate: day('2026-12-18') });
    await userEvent.click(screen.getByRole('button', { name: /\+ new task/i }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(dialog).getByText('board day: none')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fake create' }));
    expect(await screen.findByText('Saved — it’s in Dec.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show December 2026' }));
    expect(await screen.findByRole('group', { name: 'Month: December 2026' })).toBeInTheDocument();
  });

  it('a new task inside the month says nothing more', async () => {
    renderPage('/board?project=p1&month=2026-11');
    await waitFor(() => expect(card('MICO-1')).toBeTruthy());
    created = task('t9', 'MICO-9', { startDate: '2026-11-07T08:00:00.000Z', dueDate: day('2026-11-28') });
    await userEvent.click(screen.getByRole('button', { name: /\+ new task/i }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'New task' })).getByRole('button', { name: 'Fake create' }));
    expect(screen.queryByText(/Saved — it’s in/)).not.toBeInTheDocument();
  });
});

describe('Kanban Board: Month on All projects and on a read-only project', () => {
  it('All projects asks for every project’s month, and a card dropped on a status moves in its own project', async () => {
    renderPage('/board?project=all&month=2026-11');
    await waitFor(() => expect(card('MICO-1')).toBeTruthy());
    expect(monthAsks()).toContain('/tasks?month=2026-11&undated=true');
    // The archived project's tasks are not on All projects.
    expect(card('OLD-1')).toBeUndefined();
    expect(card('OPS-1')!.textContent).toContain('Due 25 Nov');
    await userEvent.click(within(card('MICO-1')!).getByRole('button', { name: 'Move MICO-1 to In Progress' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/tasks/t1/move'))?.body).toMatchObject({ columnId: 'p1-doing' }));
  });

  it('an archived project’s month can be looked at, not changed', async () => {
    renderPage('/board?project=p3&month=2026-11');
    await waitFor(() => expect(card('OLD-1')).toBeTruthy());
    expect(within(card('OLD-1')!).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /\+ new task/i })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Month: November 2026' })).toBeInTheDocument();
  });
});

describe('Kanban Board: month view review fixes', () => {
  it('Month is remembered, but this month moves on: picked on 7 Nov, the board opens on December on 2 Dec', async () => {
    const first = renderPage('/board?project=p1');
    await screen.findByRole('region', { name: 'To Do' });
    await userEvent.click(screen.getByRole('button', { name: 'Month view' }));
    await screen.findByRole('group', { name: 'Month: November 2026' });
    await waitFor(() => expect(localStorage.getItem(userStorageKey('u1', 'board.period'))).toBe('month'));
    // This month is kept as "this month", not as November.
    expect(localStorage.getItem(userStorageKey('u1', 'board.month'))).toBeNull();
    first.unmount();
    vi.setSystemTime(new Date('2026-12-02T08:00:00.000Z'));
    renderPage('/board?project=p1');
    expect(await screen.findByRole('group', { name: 'Month: December 2026' })).toBeInTheDocument();
    await waitFor(() => expect(where()).toContain('month=2026-12'));
  });

  it('a month opened by a link is the remembered choice at once (the sidebar link, same page, opens it again)', async () => {
    renderPage('/board?project=p1&month=2027-01');
    await screen.findByRole('group', { name: 'Month: January 2027' });
    await userEvent.click(screen.getByRole('button', { name: 'Sidebar board link' }));
    expect(await screen.findByRole('group', { name: 'Month: January 2027' })).toBeInTheDocument();
    await waitFor(() => expect(where()).toContain('month=2027-01'));
  });

  it('a card dropped on Done reads “Done 7 Nov” at once — no longer red — before the server answers (one project)', async () => {
    hangMoves = true;
    renderPage('/board?project=p1&month=2026-11');
    await waitFor(() => expect(card('MICO-2')).toBeTruthy());
    expect(card('MICO-2')!.textContent).toContain('Overdue · from Oct · red');
    await userEvent.click(within(card('MICO-2')!).getByRole('button', { name: 'Move MICO-2 to Done' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Done' })).getByRole('button', { name: 'Move MICO-2 to To Do' })).toBeInTheDocument());
    expect(card('MICO-2')!.textContent).toContain('MICO-2 · Done 7 Nov');
    expect(card('MICO-2')!.textContent).not.toContain('red');
  });

  it('…and on All projects', async () => {
    hangMoves = true;
    renderPage('/board?project=all&month=2026-11');
    await waitFor(() => expect(card('MICO-2')).toBeTruthy());
    await userEvent.click(within(card('MICO-2')!).getByRole('button', { name: 'Move MICO-2 to Done' }));
    await waitFor(() => expect(card('MICO-2')!.textContent).toContain('MICO-2 · Done 7 Nov'));
    expect(within(screen.getByRole('region', { name: 'Done' })).getByRole('button', { name: 'Move MICO-2 to To Do' })).toBeInTheDocument();
  });

  it('with the cards without dates left off, a drop lands in the whole column, and in-column order is off until “No date” is on', async () => {
    renderPage('/board?project=p1&month=2027-01');
    await waitFor(() => expect(card('MICO-14')).toBeTruthy());
    expect(card('MICO-12')).toBeUndefined();
    expect(screen.getByTestId('kanban')).toHaveAttribute('data-reorder', 'off');
    // Dropped between A and B as shown: after the hidden U, before B.
    await userEvent.click(within(card('MICO-14')!).getByRole('button', { name: 'Move MICO-14 to In Progress at 1' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/columns/p1-doing/tasks/reorder'))).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.url.includes('/columns/p1-doing/tasks/reorder'))!.body).toEqual({ orderedIds: ['a1', 'u1', 'x1', 'b1'] });
    await userEvent.click(screen.getByRole('button', { name: 'No date (1)' }));
    expect(screen.getByTestId('kanban')).toHaveAttribute('data-reorder', 'on');
  });

  it('“No date (N)” counts what it would add: the company filter applies to it', async () => {
    renderPage('/board?project=p1&month=2026-11');
    expect(await screen.findByRole('button', { name: 'No date (2)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filter by external company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'OXY' }));
    expect(await screen.findByRole('button', { name: 'No date (1)' })).toBeInTheDocument();
  });

  it('…and on All projects it leaves out the projects filtered off', async () => {
    localStorage.setItem(userStorageKey('u1', 'board.hiddenProjects'), JSON.stringify(['p2']));
    renderPage('/board?project=all&month=2026-11');
    await waitFor(() => expect(card('MICO-1')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'No date (2)' })).toBeInTheDocument();
  });

  it('“Saved — it’s in Dec” stays with its project and its month view', async () => {
    renderPage('/board?project=p1&month=2026-11');
    await waitFor(() => expect(card('MICO-1')).toBeTruthy());
    created = task('t9', 'MICO-9', { startDate: day('2026-12-01'), dueDate: day('2026-12-18') });
    await userEvent.click(screen.getByRole('button', { name: /\+ new task/i }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'New task' })).getByRole('button', { name: 'Fake create' }));
    expect(await screen.findByText('Saved — it’s in Dec.')).toBeInTheDocument();
    // Day and back: it doesn't come back.
    await userEvent.click(screen.getByRole('button', { name: 'Day view' }));
    await userEvent.click(screen.getByRole('button', { name: 'Month view' }));
    await screen.findByRole('group', { name: 'Month: November 2026' });
    expect(screen.queryByText('Saved — it’s in Dec.')).not.toBeInTheDocument();
    // Another project: not there either.
    await userEvent.click(screen.getByRole('button', { name: /\+ new task/i }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'New task' })).getByRole('button', { name: 'Fake create' }));
    expect(await screen.findByText('Saved — it’s in Dec.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations/ }));
    await waitFor(() => expect(card('OPS-1')).toBeTruthy());
    expect(screen.queryByText('Saved — it’s in Dec.')).not.toBeInTheDocument();
  });
});
