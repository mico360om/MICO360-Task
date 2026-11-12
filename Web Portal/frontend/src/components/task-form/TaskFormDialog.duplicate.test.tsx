import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormDialog } from './TaskFormDialog';
import { useTaskNotice } from '../../lib/task-notice';
import type { DuplicatePrefill } from '../../api/tasks';

// Duplicate Task: the New task form opened filled in from a task (GET /tasks/:id/duplicate), reviewed,
// then saved as a copy (POST /tasks/:id/duplicate) — which also copies the files when ticked.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: 'rocket', ownerId: 'u1', clientName: null },
  { id: 'p2', code: 'OPS', name: 'Ops Board', status: 'ACTIVE', color: '#0F766E', icon: null, ownerId: null, clientName: null },
  { id: 'p3', code: 'OLD', name: 'Old Archive', status: 'ARCHIVED', color: '#475569', icon: null, ownerId: null, clientName: null },
];
const COLUMNS: Record<string, unknown[]> = {
  p1: [
    { id: 'c0', projectId: 'p1', name: 'Done first', category: 'DONE', position: 0, color: '#16a34a', enabled: true },
    { id: 'c1', projectId: 'p1', name: 'To do', category: 'TODO', position: 1, color: '#64748b', enabled: true },
    { id: 'c2', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 2, color: '#2563eb', enabled: true },
  ],
  p2: [
    { id: 'd1', projectId: 'p2', name: 'Inbox', category: 'TODO', position: 0, color: '#64748b', enabled: true },
    { id: 'd2', projectId: 'p2', name: 'In progress', category: 'IN_PROGRESS', position: 1, color: '#2563eb', enabled: true },
  ],
  p3: [{ id: 'e1', projectId: 'p3', name: 'To do', category: 'TODO', position: 0, color: '#64748b', enabled: true }],
};
const person = (id: string, firstName: string, lastName: string, username: string) => ({ id, firstName, lastName, username, email: '', avatarUrl: null });
const MEMBERS: Record<string, unknown[]> = {
  p1: [person('u1', 'Mona', 'Owner', 'mona'), person('u9', 'Omar', 'A', 'omar'), person('u7', 'Sara', 'K', 'sara')],
  p2: [person('u7', 'Sara', 'K', 'sara')],
};

const PREFILL: DuplicatePrefill = {
  original: { id: 't1', key: 'MICO-12', title: 'Prepare the vendor sheet', projectId: 'p1' },
  task: {
    title: 'Prepare the vendor sheet',
    description: 'Collect quotes',
    projectId: 'p1',
    columnId: 'c1',
    priority: 'HIGH',
    startDate: '2026-11-03',
    dueDate: '2026-11-20',
    estimatedHours: 4,
    isMilestone: true,
    weight: 3,
    tags: ['safety', 'rig'],
    assigneeIds: ['u9', 'u7'],
    checklists: [{ title: 'Before', items: [{ text: 'Valves', children: [{ text: 'Main valve' }] }, { text: 'Gauges' }] }],
    // tbk: 1.24 Guests — the original's contacts are guests now (externalContacts: only ones not on a guest list yet).
    externalContacts: [],
    guests: [{ id: 'g1', name: 'Ahmed Al Said', company: 'OXY', designation: null, email: null, phone: null, note: 'Bring the permit' }],
    categoryIds: [],
    inspectionFormId: null,
    inspectionPlace: null,
  },
  watchers: [{ id: 'u7', name: 'Sara K' }],
  files: [
    { id: 'f1', filename: 'plan.pdf', sizeBytes: 300, mimeType: 'application/pdf' },
    { id: 'f2', filename: 'site.dwg', sizeBytes: 900, mimeType: 'application/acad' },
    { id: 'f3', filename: 'photo.png', sizeBytes: 50, mimeType: 'image/png' },
  ],
};

type Call = { url: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };
let calls: Call[];
let prefill: DuplicatePrefill;
let duplicateReply: () => Response | Promise<Response>;

beforeEach(() => {
  localStorage.clear();
  calls = [];
  prefill = PREFILL;
  useTaskNotice.setState({ notice: null });
  duplicateReply = () => json({ data: { id: 't40', key: 'MICO-40', title: 'x', projectId: 'p1', columnId: 'c1' }, files: { total: 3, copied: 2, failed: [{ filename: 'site.dwg', reason: 'No.' }] } }, 201);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.endsWith('/tasks/t1/duplicate') && method === 'GET') return json({ data: prefill });
      if (u.endsWith('/tasks/gone/duplicate')) return json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } }, 404);
      if (u.endsWith('/tasks/t1/duplicate') && method === 'POST') return duplicateReply();
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: COLUMNS[cols[1]!] ?? [] });
      const mem = /\/projects\/(p\d)\/members/.exec(u);
      if (mem) return json({ data: MEMBERS[mem[1]!] ?? [] });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.endsWith('/users/directory')) return json({ data: MEMBERS.p1 as unknown[] });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(id = 't1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <TaskFormDialog duplicateOfId={id} onClose={onClose} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { onClose, onCreated };
}
const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/tasks/t1/duplicate'));
const ready = async () => waitFor(() => expect(screen.getByLabelText(/^task title/i)).toHaveValue('Prepare the vendor sheet'));

describe('Duplicate: the New task form, filled in from the task', () => {
  it('is titled “Duplicate of MICO-12” and filled in from the original, to review before saving', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate of MICO-12' });
    expect(within(dialog).getByRole('heading', { name: 'Duplicate of MICO-12' })).toBeInTheDocument();
    await ready();
    expect(screen.getByLabelText(/^description/i)).toHaveValue('Collect quotes');
    expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('MICO360 Platform');
    // The first To-do column, not the original's Done column.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('To do'));
    expect(screen.getByRole('button', { name: 'Priority' })).toHaveTextContent('High');
    expect(screen.getByLabelText(/^due date/i)).toHaveValue('2026-11-20');
    expect(screen.getByRole('checkbox', { name: /milestone/i })).toBeChecked();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Omar A' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Remove Sara K' })).toBeInTheDocument();
    // The checklists, nested, nothing ticked; the guest.
    const items = within(dialog).queryAllByTestId('checklist-item').map((li) => li.querySelector('[data-edit-for]')?.textContent ?? '');
    expect(items).toEqual(['Valves', 'Main valve', 'Gauges']);
    expect(within(dialog).queryAllByRole('checkbox', { checked: true }).map((c) => c.getAttribute('aria-label') ?? (c.closest('label')?.textContent ?? ''))).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/Valves|Main valve|Gauges/)]),
    );
    expect(within(dialog).getAllByText(/Ahmed Al Said/).length).toBeGreaterThan(0);
    // No template or Describe for a copy.
    expect(screen.queryByRole('button', { name: 'Task template' })).toBeNull();
    // The start date is in the form's Start date field (future tasks); what the form has no field for is listed.
    expect(screen.getByLabelText(/^start date/i)).toHaveValue('2026-11-03');
    expect(screen.getByText('Also copied: tags safety and rig, 1 watcher and 4 h estimate.')).toBeInTheDocument();
    // The files tick, on by default.
    expect(screen.getByRole('checkbox', { name: /copy files \(3\)/i })).toBeChecked();
  });

  it('saves the copy (once, with an Idempotency-Key): the reviewed fields, the start date carried, the files tick — then the notice says how the files went', async () => {
    const { onClose, onCreated } = renderDialog();
    await ready();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Omar A' })).toBeInTheDocument());
    const title = screen.getByLabelText(/^task title/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Prepare the vendor sheet for Q1');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const sent = posts()[0]!;
    expect(sent.headers['Idempotency-Key']).toBeTruthy();
    expect(sent.body).toMatchObject({
      projectId: 'p1',
      columnId: 'c1',
      title: 'Prepare the vendor sheet for Q1',
      description: 'Collect quotes',
      priority: 'HIGH',
      dueDate: '2026-11-20',
      startDate: '2026-11-03',
      isMilestone: true,
      weight: 3,
      assigneeIds: ['u9', 'u7'],
      checklists: [{ title: 'Before', items: [{ text: 'Valves', children: [{ text: 'Main valve' }] }, { text: 'Gauges' }] }],
      guests: [{ guestId: 'g1' }],
      copyFiles: true,
    });
    // Nothing that isn't copied goes with it.
    expect(sent.body).not.toHaveProperty('recurrenceRule');
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(useTaskNotice.getState().notice).toEqual({ text: 'Task MICO-40 created · 2 of 3 files copied — “site.dwg” couldn’t be copied', taskId: 't40', key: 'MICO-40' });
  });

  it('unticked, no file is copied', async () => {
    duplicateReply = () => json({ data: { id: 't40', key: 'MICO-40' }, files: { total: 0, copied: 0, failed: [] } }, 201);
    renderDialog();
    await ready();
    await userEvent.click(screen.getByRole('checkbox', { name: /copy files \(3\)/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ copyFiles: false });
    await waitFor(() => expect(useTaskNotice.getState().notice?.text).toBe('Task MICO-40 created'));
  });

  it('a task without files has no tick', async () => {
    prefill = { ...PREFILL, files: [] };
    renderDialog();
    await ready();
    expect(screen.queryByRole('checkbox', { name: /copy files/i })).toBeNull();
  });

  it('the project can be changed: people not on it are taken off, with the form’s notice', async () => {
    renderDialog();
    await ready();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Omar A' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Ops Board/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Inbox'));
    await waitFor(() => expect(screen.getByText('Omar A isn’t on Ops Board, so they were taken off this task.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ projectId: 'p2', columnId: 'd1', assigneeIds: ['u7'] });
  });

  it('a due date before the copied start date: the form says so before sending; the start date cleared, the copy has none of its own', async () => {
    renderDialog();
    await ready();
    const due = screen.getByLabelText(/^due date/i);
    await userEvent.clear(due);
    await userEvent.type(due, '2026-11-02');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('The start date must be on or before the due date.')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText(/^start date/i));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ startDate: null, dueDate: '2026-11-02' });
  });

  it('offline: says a duplicate needs the connection, and keeps the form (nothing is queued)', async () => {
    duplicateReply = () => Promise.reject(new TypeError('Failed to fetch'));
    const { onClose } = renderDialog();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You’re offline. Duplicating a task needs the connection');
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('a task that can’t be opened any more: says so', async () => {
    renderDialog('gone');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open the task to duplicate');
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
  });
});

// Review fix N8 (13 Nov 2026): Duplicate keeps one Idempotency-Key across retries, as New task does.
describe('Duplicate: the same request key across retries', () => {
  const keys = () => posts().map((c) => c.headers['Idempotency-Key']);
  const save = async (n: number) => {
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(n));
  };

  it('a server error, then Create again: the same key; a definite refusal: a new one', async () => {
    let n = 0;
    duplicateReply = () =>
      ++n === 1
        ? json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500)
        : n === 2
          ? json({ error: { code: 'VALIDATION', message: 'Choose a column.' } }, 400)
          : json({ data: { id: 't40', key: 'MICO-40', title: 'x', projectId: 'p1', columnId: 'c1' }, files: { total: 0, copied: 0, failed: [] } }, 201);
    renderDialog();
    await ready();
    await save(1);
    await screen.findByText(/Couldn’t duplicate the task/);
    await save(2);
    await waitFor(() => expect(screen.getByText(/Choose a column/)).toBeInTheDocument());
    await save(3);
    expect(keys()[1]).toBe(keys()[0]);
    expect(keys()[2]).not.toBe(keys()[1]);
  });
});
