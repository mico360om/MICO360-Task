import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormDialog } from './TaskFormDialog';
import type { ApiTask } from '../../api/tasks';

// Tasks scheduled for the future (owner, 10 Nov 2026): the New/Edit task form's Start date, its
// "Scheduled for 20 Nov" note, the start-before-due rule and what is sent.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: null, ownerId: null, clientName: null },
  { id: 'p2', code: 'DUE', name: 'Due Today Project', status: 'ACTIVE', color: '#0F766E', icon: null, ownerId: null, clientName: null, defaultDueToday: true },
];
const COLUMNS: Record<string, unknown[]> = {
  p1: [
    { id: 'c1', projectId: 'p1', name: 'Backlog', category: 'TODO', position: 0, color: '#64748b', enabled: true },
    { id: 'c2', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '#2563eb', enabled: true },
  ],
  p2: [{ id: 'd1', projectId: 'p2', name: 'To Do', category: 'TODO', position: 0, color: '#64748b', enabled: true }],
};

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];

const TASK: ApiTask = {
  id: 't1', key: 'MICO-12', title: 'Prepare the vendor sheet', description: '', projectId: 'p1', columnId: 'c1', columnCategory: 'TODO',
  position: 0, priority: 'NORMAL', startDate: '2026-11-08T05:00:00.000Z', dueDate: '2026-11-30T00:00:00.000Z', progress: 0, completedAt: null, createdAt: '', updatedAt: '', version: 3,
  boardDate: '2026-11-10T12:00:00.000Z', recurrenceRule: null, recurrenceParentId: null, recurrenceNextId: null,
} as ApiTask;

beforeEach(() => {
  // 10:00 on Tue 10 Nov 2026 in Muscat (only the clock is faked: typing and clicking run as usual).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T06:00:00Z'));
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body });
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: COLUMNS[cols[1]!] ?? [] });
      if (/\/projects\/p\d\/members/.test(u)) return json({ data: [] });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      if (u.endsWith('/tasks') && method === 'POST') return json({ data: { id: 't99', key: 'MICO-9', title: body?.title, projectId: body?.projectId, columnId: body?.columnId } }, 201);
      if (u.endsWith('/tasks/t1/assignees') && method === 'GET') return json({ data: [] });
      if (/\/tasks\/t1$/.test(u) && method === 'PUT') return json({ data: { ...TASK, ...body, version: 4 } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(props: Partial<React.ComponentProps<typeof TaskFormDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <TaskFormDialog onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}
const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/tasks'));
const puts = () => calls.filter((c) => c.method === 'PUT' && /\/tasks\/t1$/.test(c.url));
const ready = async (column = 'Backlog') => waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent(column));
const startField = () => screen.getByLabelText(/^start date/i) as HTMLInputElement;
const dueField = () => screen.getByLabelText(/^due date/i) as HTMLInputElement;
const setDate = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });

describe('Start date on the New task form', () => {
  it('is a date field next to the due date, empty by default, with no note', async () => {
    renderDialog();
    await ready();
    expect(startField().type).toBe('date');
    expect(startField().value).toBe('');
    expect(screen.queryByText(/Scheduled for/)).toBeNull();
  });

  it('a start later than today says “Scheduled for 20 Nov” under it (tied to the field); today or earlier, nothing', async () => {
    renderDialog();
    await ready();
    setDate(startField(), '2026-11-20');
    const note = await screen.findByText('Scheduled for 20 Nov — it waits under Upcoming until then.');
    expect(startField().getAttribute('aria-describedby')).toContain(note.id);
    setDate(startField(), '2026-11-10');
    expect(screen.queryByText(/Scheduled for/)).toBeNull();
    setDate(startField(), '2026-11-02');
    expect(screen.queryByText(/Scheduled for/)).toBeNull();
  });

  it('“today” is the company’s day: just after midnight in Muscat (still yesterday in UTC), tomorrow’s date is today', async () => {
    vi.setSystemTime(new Date('2026-11-10T20:30:00Z')); // 00:30 on 11 Nov in Muscat
    renderDialog();
    await ready();
    setDate(startField(), '2026-11-11');
    expect(screen.queryByText(/Scheduled for/)).toBeNull();
    setDate(startField(), '2026-11-12');
    expect(await screen.findByText(/Scheduled for 12 Nov/)).toBeInTheDocument();
  });

  it('sends the start date; from a board, the board’s day only when no later start was picked', async () => {
    renderDialog({ boardDate: '2026-11-10' });
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Pour the slab');
    setDate(startField(), '2026-11-20');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ title: 'Pour the slab', startDate: '2026-11-20' });
    expect(posts()[0]!.body).not.toHaveProperty('boardDate');
  });

  it('without a later start, the board’s day is sent as before (and no start date)', async () => {
    renderDialog({ boardDate: '2026-11-12' });
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Check the drawings');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ boardDate: '2026-11-12' });
    expect(posts()[0]!.body).not.toHaveProperty('startDate');
  });

  it('a start after the due date is refused in the server’s words, before anything is sent', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Pour the slab');
    setDate(startField(), '2026-11-20');
    setDate(dueField(), '2026-11-15');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const error = await screen.findByText('The start date must be on or before the due date.');
    expect(startField()).toHaveAttribute('aria-invalid', 'true');
    expect(startField().getAttribute('aria-describedby')).toContain(error.id);
    expect(posts()).toHaveLength(0);
    setDate(dueField(), '2026-11-20');
    expect(screen.queryByText('The start date must be on or before the due date.')).toBeNull();
  });

  it('in a project whose new tasks are due today, a later start makes it due on its start day (as the server does)', async () => {
    renderDialog({ defaultProjectId: 'p2' });
    await ready('To Do');
    expect(await screen.findByText('Due today (this project’s setting)')).toBeInTheDocument();
    setDate(startField(), '2026-11-20');
    expect(await screen.findByText('Due Fri 20 Nov (this project’s setting)')).toBeInTheDocument();
  });
});

describe('Start date on the Edit task form', () => {
  it('shows the task’s start, and sends it only when changed (cleared: null)', async () => {
    renderDialog({ task: TASK });
    await waitFor(() => expect(startField().value).toBe('2026-11-08'));
    await userEvent.clear(screen.getByLabelText(/^task title/i));
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).not.toHaveProperty('startDate');
  });

  it('moving a not-started task’s start later says it will wait, and sends the new day', async () => {
    renderDialog({ task: TASK });
    await waitFor(() => expect(startField().value).toBe('2026-11-08'));
    setDate(startField(), '2026-11-24');
    expect(await screen.findByText('Scheduled for 24 Nov — it waits under Upcoming until then.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toMatchObject({ startDate: '2026-11-24' });
  });

  it('clearing the start sends null', async () => {
    renderDialog({ task: TASK });
    await waitFor(() => expect(startField().value).toBe('2026-11-08'));
    setDate(startField(), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toMatchObject({ startDate: null });
  });

  it('a task already under way: a later start doesn’t make it wait, and the form says so', async () => {
    renderDialog({ task: { ...TASK, columnId: 'c2', columnCategory: 'IN_PROGRESS' } });
    await waitFor(() => expect(startField().value).toBe('2026-11-08'));
    setDate(startField(), '2026-11-24');
    expect(await screen.findByText('It’s already under way, so it stays where it is.')).toBeInTheDocument();
    expect(screen.queryByText(/Scheduled for/)).toBeNull();
  });

  it('a task that waits says so as it opens', async () => {
    renderDialog({ task: { ...TASK, startDate: '2026-11-20T00:00:00.000Z', boardDate: '2026-11-20T12:00:00.000Z' } });
    expect(await screen.findByText('Scheduled for 20 Nov — it waits under Upcoming until then.')).toBeInTheDocument();
  });
});
