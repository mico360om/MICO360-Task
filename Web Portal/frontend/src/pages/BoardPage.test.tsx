import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { useAuthStore } from '../stores/auth-store';
import { clearQueue, getQueue, localStorageQueueStore } from '../lib/offline-queue';
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

const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' },
  { id: 'p2', code: 'OPS', name: 'Operations', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#1E8B1E', createdAt: '', updatedAt: '' },
];

type Call = { url: string; method: string; body?: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[] = [];
let failCreate: 'network' | null = null;
let failColumnDelete = false;

beforeEach(() => {
  calls = [];
  failCreate = null;
  failColumnDelete = false;
  clearQueue(localStorageQueueStore);
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (method === 'DELETE' && u.includes('/columns/')) {
        return failColumnDelete ? json({ error: { code: 'CONFLICT', message: 'Move this column’s tasks first.' } }, 409) : new Response(null, { status: 204 });
      }
      if (method === 'POST' && u.endsWith('/tasks')) {
        if (failCreate === 'network') throw new TypeError('Failed to fetch');
        return json({ data: { id: 't9' } }, 201);
      }
      if (u.includes('/members')) return json({ data: [{ id: 'u2', username: 'omar', email: 'o@x', firstName: 'Omar', lastName: 'A', role: 'MEMBER' }] });
      if (u.includes('/columns')) {
        const pid = u.includes('/projects/p2/') ? 'p2' : 'p1';
        return json({
          data: [
            { id: `c-${pid}`, projectId: pid, name: pid === 'p2' ? 'Ops To Do' : 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
            { id: `c-${pid}-ip`, projectId: pid, name: 'In Progress', category: 'IN_PROGRESS', position: 1, color: '#C98A1B', enabled: true },
          ],
        });
      }
      if (u.includes('/tasks')) {
        return json({ data: [{ id: 't1', key: 'MICO-1', title: 'Prepare report', description: null, projectId: 'p1', columnId: 'c-p1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' }] });
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

function renderPage(path = '/board') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillNewTask() {
  await userEvent.click(await screen.findByRole('button', { name: /\+ new task/i }));
  const dialog = await screen.findByRole('dialog', { name: /new task/i });
  await userEvent.type(within(dialog).getByLabelText(/task title/i), 'Ship it');
  fireEvent.change(within(dialog).getByLabelText(/due date/i), { target: { value: '2026-10-05' } });
  const people = within(dialog).getByRole('combobox', { name: 'Add people' });
  await waitFor(() => expect(people).toBeEnabled());
  await userEvent.click(people);
  await userEvent.type(people, 'om');
  await userEvent.click(await within(dialog).findByRole('option', { name: /Omar A/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
}

describe('BoardPage: layout', () => {
  it('keeps the page title whole: the project’s name is in the picker (with its full name on hover), not squeezed beside the title', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'To Do' });
    const h1 = screen.getByRole('heading', { level: 1, name: 'Kanban Board' });
    // No subtitle beside the title (PageTitle shrinks the title along with a long subtitle).
    expect(h1.parentElement!.querySelector('p')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select project' }).closest('[title]')).toHaveAttribute('title', 'MICO360 Platform');
  });

  it('holds the board’s place while it loads (no text that jumps when the columns arrive)', async () => {
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (String(url).includes('/tasks') ? new Promise<Response>(() => {}) : base(url, init))));
    renderPage();
    expect(await screen.findByRole('status', { name: 'Loading the board' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('says plainly when there is no project yet', async () => {
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (String(url).endsWith('/projects') ? json({ data: [] }) : base(url, init))));
    renderPage();
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
  });
});

describe('BoardPage', () => {
  it('loads columns and tasks from the API and renders the board', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('region', { name: 'To Do' })).toBeInTheDocument());
    expect(screen.getByText('Prepare report')).toBeInTheDocument();
    // The project picker shows the chosen project's picture (its initials: none saved).
    const picker = document.querySelector('button[aria-haspopup="listbox"] [data-project-avatar]');
    expect(picker).toHaveTextContent('MP');
  });

  it('tells assistive tech whether the column manager is open', async () => {
    renderPage();
    const toggle = await screen.findByRole('button', { name: 'Manage columns' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers Manage columns to an employee who runs the project, and not to one who doesn’t', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    const base = vi.mocked(fetch).getMockImplementation()!;
    let runs = true;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/projects')) return json({ data: PROJECTS.map((p) => ({ ...p, canManage: runs && p.id === 'p1' })) });
      return base(url, init);
    });
    const first = renderPage();
    expect(await screen.findByRole('button', { name: 'Manage columns' })).toBeInTheDocument();
    first.unmount();
    runs = false;
    renderPage();
    await screen.findByText('Prepare report');
    expect(screen.queryByRole('button', { name: 'Manage columns' })).not.toBeInTheDocument();
  });

  it('creates a task with its due date and assignees in ONE request, with an Idempotency-Key', async () => {
    renderPage();
    await screen.findByText('Prepare report');
    await fillNewTask();
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/tasks'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks'))!;
    expect(post.body).toMatchObject({ title: 'Ship it', dueDate: '2026-10-05', assigneeIds: ['u2'], projectId: 'p1', columnId: 'c-p1' });
    expect(post.headers['Idempotency-Key']).toBeTruthy();
    // no second "assign" call that could fail half-way
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/assignees'))).toBe(false);
  });

  it('adds a task straight into the column it was asked from', async () => {
    renderPage();
    await screen.findByText('Prepare report');
    const column = await screen.findByRole('region', { name: 'In Progress' });
    await userEvent.click(within(column).getByRole('button', { name: /no tasks.*add a task/i }));
    const dialog = await screen.findByRole('dialog', { name: /new task/i });
    await userEvent.type(within(dialog).getByLabelText(/task title/i), 'Fix the pump');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/tasks'))).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks'))!.body).toMatchObject({ title: 'Fix the pump', projectId: 'p1', columnId: 'c-p1-ip' });
  });

  it('fits short screens: the new-task fields scroll while "Create task" stays in view', async () => {
    renderPage();
    await screen.findByText('Prepare report');
    await userEvent.click(await screen.findByRole('button', { name: /\+ new task/i }));
    const dialog = await screen.findByRole('dialog', { name: /new task/i });
    expect(dialog.className).toMatch(/sm:max-h-\[calc\(var\(--visible-height\)\*0\.9\)\]/);
    const body = within(dialog).getByLabelText(/task title/i).closest('.overflow-y-auto')!;
    expect(body.contains(within(dialog).getByRole('button', { name: 'Create task' }))).toBe(false);
  });

  it('creates a repeating task from the board', async () => {
    renderPage();
    await screen.findByText('Prepare report');
    await userEvent.click(await screen.findByRole('button', { name: /\+ new task/i }));
    const dialog = await screen.findByRole('dialog', { name: /new task/i });
    await userEvent.type(within(dialog).getByLabelText(/task title/i), 'Month-end close');
    fireEvent.change(within(dialog).getByLabelText(/^due date/i), { target: { value: '2026-10-30' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Repeat' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Monthly' }));
    await userEvent.selectOptions(within(dialog).getByLabelText(/monthly on/i), 'WEEKDAY');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/tasks'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks'))!;
    // 30 Oct 2026 is the last Friday of the month.
    expect(post.body).toMatchObject({ title: 'Month-end close', dueDate: '2026-10-30', recurrenceRule: { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } } });
  });

  it('queues an offline create with its due date, assignees and the same Idempotency-Key', async () => {
    failCreate = 'network';
    renderPage();
    await screen.findByText('Prepare report');
    await fillNewTask();
    await screen.findByText(/you’re offline — the task was saved/i);
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks'))!;
    const [item] = getQueue(localStorageQueueStore);
    expect(item!.kind).toBe('task.create');
    expect(item!.ownerId).toBe('u1');
    expect(item!.payload).toMatchObject({ dueDate: '2026-10-05', assigneeIds: ['u2'] });
    expect(item!.idempotencyKey).toBe(post.headers['Idempotency-Key']);
  });

  it('opens the project named in ?project= (the "Open board" link), not the last-viewed one', async () => {
    localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'p1');
    renderPage('/board?project=p2');
    expect(await screen.findByRole('region', { name: 'Ops To Do' })).toBeInTheDocument();
  });

  it('remembers the last project per user', async () => {
    localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'p2');
    renderPage('/board');
    expect(await screen.findByRole('region', { name: 'Ops To Do' })).toBeInTheDocument();
  });

  it('shows why a column change failed (e.g. deleting a column that still has tasks)', async () => {
    failColumnDelete = true;
    renderPage();
    await screen.findByText('Prepare report');
    await userEvent.click(screen.getByRole('button', { name: /manage columns/i }));
    await userEvent.click(await screen.findByRole('button', { name: /delete to do/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText('Move this column’s tasks first.')).toBeInTheDocument();
  });

  it('leaves the board of a project the user was just removed from (project:removed)', async () => {
    renderPage('/board?project=p2');
    await screen.findByRole('region', { name: 'Ops To Do' });
    act(() => liveHandler?.('project:removed', { projectId: 'p2' }));
    expect(await screen.findByText(/you were removed from operations/i)).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'To Do' })).toBeInTheDocument();
    expect(localStorage.getItem(userStorageKey('u1', 'board.projectId'))).toBeNull();
  });
});

describe('Board cards: moving a task to another project', () => {
  const TARGET_PROJECTS = PROJECTS.map((p) => ({ id: p.id, code: p.code, name: p.name, status: 'ACTIVE', color: p.color, icon: null, imageUrl: null }));
  /** Where tasks may go and the move itself, on top of the board's usual answers; the task leaves the board once moved. */
  function withMoves(opts: { managesAll?: boolean; managed?: string[] } = {}) {
    let moved = false;
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/tasks/move-targets')) return json({ data: { managesAll: opts.managesAll ?? true, managedProjectIds: opts.managed ?? [], projects: TARGET_PROJECTS } });
      if (u.endsWith('/tasks/move-preview')) {
        return json({ data: { project: { ...TARGET_PROJECTS[1], defaultDueToday: false }, columns: [{ id: 'c-p2', name: 'Ops To Do', category: 'TODO', position: 0, enabled: true }], outsiders: [], tasks: [
          { id: 't1', key: 'MICO-1', title: 'Prepare report', from: { id: 'p1', code: 'MICO', name: 'MICO360 Platform' }, canMove: true, reason: null, newKey: 'OPS-17', currentCategory: 'TODO', columnId: 'c-p2', milestoneCleared: false, dueDate: null, repeat: null, outsiders: [] },
        ] } });
      }
      if (u.endsWith('/tasks/t1/move-to-project') && method === 'POST') {
        moved = true;
        calls.push({ url: u, method, body: JSON.parse(String(init!.body)), headers: {} });
        return json({ data: { task: { id: 't1', key: 'OPS-17', projectId: 'p2' }, from: { projectId: 'p1', name: 'MICO360 Platform', key: 'MICO-1' }, to: { projectId: 'p2', name: 'Operations', key: 'OPS-17' }, addedToTeam: [], unassigned: [], milestoneCleared: false, dueDateSet: null } });
      }
      if (moved && u.includes('/tasks?')) return json({ data: [] });
      return base(url, init);
    });
  }

  it('each card’s menu offers “Move to another project…”: the card leaves the board and a toast says where it went', async () => {
    withMoves();
    renderPage();
    await screen.findByRole('button', { name: 'MICO-1: Prepare report' });
    await userEvent.click(screen.getByRole('button', { name: 'More actions for MICO-1' }));
    const menu = await screen.findByRole('menu', { name: 'Actions for MICO-1' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move to another project…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move to another project' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations/ }));
    await userEvent.click(await within(dialog).findByRole('button', { name: /^Move task/ }));
    const toast = await screen.findByText('Moved to Operations as OPS-17');
    expect(toast.closest('[role="status"]')).not.toBeNull();
    expect(calls.find((c) => c.url.endsWith('/tasks/t1/move-to-project'))?.body).toEqual({ projectId: 'p2', columnId: 'c-p2' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'MICO-1: Prepare report' })).not.toBeInTheDocument());
  });

  it('for someone who can’t move the task, the card has no ⋯ menu at all', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    withMoves({ managesAll: false, managed: ['p2'] });
    renderPage();
    await screen.findByRole('button', { name: 'MICO-1: Prepare report' });
    // Once it is known where they may move tasks (to Operations, but not out of this project).
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/tasks/move-targets')) || vi.mocked(fetch).mock.calls.some((c) => String(c[0]).endsWith('/tasks/move-targets'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'More actions for MICO-1' })).not.toBeInTheDocument();
  });

  it('after a move, focus goes to the next card in its column (not lost on the page)', async () => {
    withMoves();
    const base = vi.mocked(fetch).getMockImplementation()!;
    let moved = false;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith('/tasks/t1/move-to-project')) moved = true;
      if (u.includes('/tasks?')) {
        const t = (id: string, key: string, title: string) => ({ id, key, title, description: null, projectId: 'p1', columnId: 'c-p1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' });
        return json({ data: moved ? [t('t2', 'MICO-2', 'Check figures')] : [t('t1', 'MICO-1', 'Prepare report'), t('t2', 'MICO-2', 'Check figures')] });
      }
      return base(url, init);
    });
    renderPage();
    await screen.findByRole('button', { name: 'MICO-1: Prepare report' });
    await userEvent.click(screen.getByRole('button', { name: 'More actions for MICO-1' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to another project…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move to another project' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations/ }));
    await userEvent.click(await within(dialog).findByRole('button', { name: /^Move task/ }));
    await screen.findByText('Moved to Operations as OPS-17');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'MICO-1: Prepare report' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'MICO-2: Check figures' })).toHaveFocus());
  });

  it('the card menu works from the keyboard: it opens on its first item, Escape closes it back to its button', async () => {
    withMoves();
    renderPage();
    await screen.findByRole('button', { name: 'MICO-1: Prepare report' });
    const button = screen.getByRole('button', { name: 'More actions for MICO-1' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Move to another project…' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Actions for MICO-1' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
