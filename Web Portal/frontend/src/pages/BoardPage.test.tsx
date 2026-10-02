import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
        return json({ data: [{ id: `c-${pid}`, projectId: pid, name: pid === 'p2' ? 'Ops To Do' : 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true }] });
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
  await userEvent.type(within(dialog).getByLabelText(/due date/i), '2026-10-05');
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Omar A' }));
  await userEvent.click(within(dialog).getByRole('button', { name: /add task/i }));
}

describe('BoardPage', () => {
  it('loads columns and tasks from the API and renders the board', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('region', { name: 'To Do' })).toBeInTheDocument());
    expect(screen.getByText('Prepare report')).toBeInTheDocument();
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

  it('fits short screens: the new-task dialog scrolls instead of pushing "Add task" off-screen', async () => {
    renderPage();
    await screen.findByText('Prepare report');
    await userEvent.click(await screen.findByRole('button', { name: /\+ new task/i }));
    const dialog = await screen.findByRole('dialog', { name: /new task/i });
    expect(dialog.className).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
    expect(dialog.className).toContain('overflow-y-auto');
  });

  it('creates a repeating task from the board', async () => {
    renderPage();
    await screen.findByText('Prepare report');
    await userEvent.click(await screen.findByRole('button', { name: /\+ new task/i }));
    const dialog = await screen.findByRole('dialog', { name: /new task/i });
    await userEvent.type(within(dialog).getByLabelText(/task title/i), 'Month-end close');
    await userEvent.type(within(dialog).getByLabelText(/^due date$/i), '2026-10-30');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^repeat$/i), 'MONTHLY');
    await userEvent.selectOptions(within(dialog).getByLabelText(/monthly on/i), 'WEEKDAY');
    await userEvent.click(within(dialog).getByRole('button', { name: /add task/i }));
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
