import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskTable, type TaskTableProps } from './TaskTable';
import { useAuthStore } from '../../stores/auth-store';
import type { ApiTask } from '../../api/tasks';
import type { ApiProject } from '../../api/projects';
import type { ApiColumn } from '../../api/columns';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECT = { id: 'p1', code: 'MICO', name: 'Platform', status: 'ACTIVE', color: '#8B1E1E', imageUrl: null, ownerId: 'u5' } as unknown as ApiProject;
const OPS = { id: 'p2', code: 'OPS', name: 'Operations', status: 'ACTIVE', color: '#1E8B1E', imageUrl: null } as unknown as ApiProject;
const COLUMNS: ApiColumn[] = [
  { id: 'c-todo', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#3A6EA5', enabled: true },
  { id: 'c-ip', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '#C98A1B', enabled: true },
  { id: 'c-done', projectId: 'p1', name: 'Done', category: 'DONE', position: 2, color: '#2E7D32', enabled: true },
];
const task = (patch: Partial<ApiTask>): ApiTask => ({
  id: 't1',
  key: 'MICO-1',
  title: 'Pour slab B',
  description: null,
  projectId: 'p1',
  columnId: 'c-todo',
  columnCategory: 'TODO',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  progress: 0,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
  assignees: [{ id: 'u1', name: 'Ada Lovelace' }],
  ...patch,
});
const TASKS = [
  task({}),
  task({ id: 't2', key: 'MICO-2', title: 'Order rebar', priority: 'HIGH', columnId: 'c-ip', columnCategory: 'IN_PROGRESS', assignees: [], needsApproval: true }),
  task({ id: 't3', key: 'MICO-3', title: 'Site walk', priority: 'LOW', isMilestone: true }),
];

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let refuse: { status: number; code: string; message: string } | null = null;
let moveWaits = false;

beforeEach(() => {
  calls = [];
  refuse = null;
  moveWaits = false;
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'UTC', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (method !== 'GET' && refuse) return json({ error: { code: refuse.code, message: refuse.message } }, refuse.status);
      if (u.includes('/members')) {
        return json({ data: [
          { id: 'u1', username: 'ada', email: 'a@x', firstName: 'Ada', lastName: 'Lovelace', role: 'MEMBER' },
          { id: 'u2', username: 'omar', email: 'o@x', firstName: 'Omar', lastName: 'Ahmed', role: 'MEMBER' },
          // Not to be assigned: in none of the project’s companies any more, or deactivated.
          { id: 'u3', username: 'gone', email: 'g@x', firstName: 'Gone', lastName: 'Away', role: 'MEMBER', hasAccess: false },
          { id: 'u4', username: 'left', email: 'l@x', firstName: 'Left', lastName: 'Company', role: 'MEMBER' },
        ] });
      }
      if (u.endsWith('/users/directory')) {
        return json({ data: [
          { id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace', avatarUrl: null },
          { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Ahmed', avatarUrl: null },
          { id: 'u4', username: 'left', firstName: 'Left', lastName: 'Company', avatarUrl: null, active: false },
          { id: 'u5', username: 'olga', firstName: 'Olga', lastName: 'Owner', avatarUrl: null },
        ] });
      }
      if (u.includes('/projects/p2/columns')) return json({ data: [{ id: 'o-todo', projectId: 'p2', name: 'Ops queue', category: 'TODO', position: 0, color: '#000', enabled: true }, { id: 'o-done', projectId: 'p2', name: 'Ops done', category: 'DONE', position: 1, color: '#000', enabled: true }] });
      if (u.includes('/columns')) return json({ data: COLUMNS });
      if (method === 'PATCH' && u.includes('/move')) {
        const id = u.split('/tasks/')[1]!.split('/')[0]!;
        const t = TASKS.find((x) => x.id === id)!;
        return json({ data: moveWaits ? { ...t, approvalRequestedAt: '2026-11-05T08:00:00.000Z' } : { ...t, columnId: body.columnId, columnCategory: COLUMNS.find((c) => c.id === body.columnId)?.category } });
      }
      if (method === 'PUT' && u.includes('/tasks/')) {
        const id = u.split('/tasks/')[1]!;
        return json({ data: { ...TASKS.find((x) => x.id === id)!, ...body } });
      }
      if (u.includes('/assignees')) return method === 'DELETE' ? new Response(null, { status: 204 }) : json({ data: [] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function show(props: Partial<TaskTableProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpen = vi.fn();
  const all: TaskTableProps = { page: 'test', label: 'Tasks of Platform', tasks: TASKS, projects: [PROJECT], columns: COLUMNS, onOpen, filterBar: true, ...props };
  const r = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskTable {...all} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...r, onOpen, qc };
}
const row = (key: string) => screen.getByRole('rowheader', { name: new RegExp(key) }).closest('tr')!;

describe('TaskTable', () => {
  it('has the task columns: No., Title, Assignees, Priority, Due date, Status — and Open', () => {
    show();
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(heads).toEqual(['No.', 'Title', 'Assignees', 'Priority', 'Due date', 'Status', 'Open']);
    expect(within(row('MICO-3')).getByRole('img', { name: 'Milestone' })).toBeInTheDocument();
  });

  it('adds Project on My Tasks and All projects', () => {
    show({ projects: [PROJECT, OPS], columns: undefined, showProject: true, tasks: [...TASKS, task({ id: 't9', key: 'OPS-1', title: 'Ops thing', projectId: 'p2', columnId: 'o-todo' })] });
    expect(screen.getByRole('columnheader', { name: /Project/ })).toBeInTheDocument();
    expect(within(row('OPS-1')).getByText('Operations')).toBeInTheDocument();
  });

  it('changes a title in place: shown at once, saved with PUT /tasks/:id', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Change the title of MICO-1: Pour slab B' }));
    await user.clear(screen.getByRole('textbox', { name: 'The title of MICO-1' }));
    await user.type(screen.getByRole('textbox', { name: 'The title of MICO-1' }), 'Pour slab C{Enter}');
    expect(screen.getByRole('button', { name: 'Change the title of MICO-1: Pour slab C' })).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: expect.stringContaining('/tasks/t1'), body: { title: 'Pour slab C' } }));
  });

  it('puts the old title back and says why when the server refuses', async () => {
    const user = userEvent.setup();
    refuse = { status: 400, code: 'VALIDATION', message: 'That title is too long.' };
    show();
    await user.click(screen.getByRole('button', { name: /Change the title of MICO-1/ }));
    await user.type(screen.getByRole('textbox'), ' more{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save — That title is too long.');
    expect(screen.getByRole('button', { name: 'Change the title of MICO-1: Pour slab B' })).toBeInTheDocument();
  });

  it('changes priority and the due date with their pickers', async () => {
    const user = userEvent.setup();
    show();
    await user.click(within(row('MICO-1')).getByRole('button', { name: 'Priority of MICO-1: Normal' }));
    await user.click(screen.getByRole('option', { name: 'Urgent' }));
    expect(within(row('MICO-1')).getByRole('button', { name: 'Priority of MICO-1: Urgent' })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.body?.priority === 'URGENT')).toBe(true));
  });

  it('offers the project’s columns as statuses and moves with PATCH /tasks/:id/move', async () => {
    const user = userEvent.setup();
    show();
    await user.click(within(row('MICO-1')).getByRole('button', { name: 'Status of MICO-1: To Do' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['To Do', 'Doing', 'Done']);
    await user.click(screen.getByRole('option', { name: 'Doing' }));
    expect(within(row('MICO-1')).getByRole('button', { name: 'Status of MICO-1: Doing' })).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: expect.stringContaining('/tasks/t1/move'), body: { columnId: 'c-ip' } }));
  });

  it('a task that needs approval goes to wait, as on the board, and says so', async () => {
    const user = userEvent.setup();
    moveWaits = true;
    show();
    await user.click(within(row('MICO-2')).getByRole('button', { name: 'Status of MICO-2: Doing' }));
    await user.click(screen.getByRole('option', { name: 'Done' }));
    expect(await screen.findByText(/waiting for a project manager/i)).toBeInTheDocument();
    // It stays where it waits.
    expect(within(row('MICO-2')).getByRole('button', { name: 'Status of MICO-2: Doing' })).toBeInTheDocument();
  });

  it('a row of another project offers that project’s own columns', async () => {
    const user = userEvent.setup();
    show({ projects: [PROJECT, OPS], columns: undefined, showProject: true, tasks: [task({ id: 't9', key: 'OPS-1', title: 'Ops thing', projectId: 'p2', columnId: 'o-todo' })] });
    // Its own column's name, once its project's columns are in.
    await user.click(await within(row('OPS-1')).findByRole('button', { name: 'Status of OPS-1: Ops queue' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ops queue', 'Ops done']);
  });

  it('ticks people on and off from the project’s team', async () => {
    const user = userEvent.setup();
    show();
    await user.click(within(row('MICO-1')).getByRole('button', { name: 'People on MICO-1: Ada Lovelace' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Omar Ahmed' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.includes('/tasks/t1/assignees'))?.body).toEqual({ userIds: ['u2'] }));
    await user.click(screen.getByRole('checkbox', { name: 'Ada Lovelace' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/tasks/t1/assignees/u1'))).toBe(true));
  });

  it('an archived project’s table is to look at: no quick edits, the title opens the task', async () => {
    const user = userEvent.setup();
    const { onOpen } = show({ readOnly: 'archived' });
    expect(screen.queryByRole('button', { name: /Change the title/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Status of/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Priority of/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /People on/ })).toBeNull();
    // The title opens it too (named by its words; the row's Open button says "Open MICO-1: …").
    await user.click(screen.getByRole('button', { name: 'Pour slab B' }));
    expect(onOpen).toHaveBeenCalledWith('t1', ['t1', 't2', 't3']);
  });

  it('Open at the end of the row opens the task, with the rows as shown for Previous / Next', async () => {
    const user = userEvent.setup();
    const { onOpen } = show();
    await user.click(within(row('MICO-2')).getByRole('button', { name: 'Open MICO-2: Order rebar' }));
    expect(onOpen).toHaveBeenCalledWith('t2', ['t1', 't2', 't3']);
  });

  it('its own filter bar narrows the rows and counts them', async () => {
    const user = userEvent.setup();
    show();
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Filter rows' }), 'mico 2');
    expect(screen.getAllByRole('rowheader')).toHaveLength(1);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Filter by assignee' }));
    await user.click(screen.getByRole('option', { name: 'Unassigned' }));
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([expect.stringContaining('Order rebar')]);
  });

  it('remembers its sort for the person on that page', async () => {
    const user = userEvent.setup();
    const first = show();
    await user.click(within(screen.getByRole('columnheader', { name: /Priority/ })).getByRole('button'));
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([expect.stringContaining('Order rebar'), expect.stringContaining('Pour slab B'), expect.stringContaining('Site walk')]);
    first.unmount();
    show();
    expect(screen.getByRole('columnheader', { name: /Priority/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('offers as assignees only people the server takes: the team (not those without access or deactivated) and the owner', async () => {
    const user = userEvent.setup();
    show();
    await user.click(within(row('MICO-1')).getByRole('button', { name: /People on MICO-1/ }));
    await screen.findByRole('checkbox', { name: 'Omar Ahmed' });
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    for (const name of ['Olga Owner', 'Ada Lovelace', 'Omar Ahmed']) expect(screen.getByRole('checkbox', { name })).toBeInTheDocument();
    for (const name of ['Gone Away', 'Left Company']) expect(screen.queryByRole('checkbox', { name })).toBeNull();
  });

  it('changes a due date as a calendar day, and takes it off with "No due date"', async () => {
    const user = userEvent.setup();
    show({ tasks: [task({ dueDate: '2026-03-10T00:00:00.000Z' })] });
    const chip = within(row('MICO-1')).getByRole('button', { name: 'Due date of MICO-1: 10 Mar 2026, overdue' });
    expect(chip).toHaveTextContent(/Overdue · 10 Mar/);
    await user.click(chip);
    await user.click(screen.getByRole('button', { name: 'Fri 13 Mar 2026' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ dueDate: '2026-03-13' }));
    await user.click(within(row('MICO-1')).getByRole('button', { name: /^Due date of MICO-1: 13 Mar 2026/ }));
    await user.click(screen.getByRole('button', { name: 'No due date' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ dueDate: null }));
  });

  it('a quick edit changes this task only — no "series" scope, as the task panel’s default', async () => {
    const user = userEvent.setup();
    show({ tasks: [task({ recurrenceRule: { frequency: 'WEEKLY', interval: 1 } as never })] });
    await user.click(within(row('MICO-1')).getByRole('button', { name: 'Priority of MICO-1: Normal' }));
    await user.click(screen.getByRole('option', { name: 'High' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ priority: 'HIGH' }));
  });

  it('puts the status back when the move is refused', async () => {
    const user = userEvent.setup();
    refuse = { status: 409, code: 'CONFLICT', message: 'That column is not on this project’s board.' };
    show();
    await user.click(within(row('MICO-1')).getByRole('button', { name: 'Status of MICO-1: To Do' }));
    await user.click(screen.getByRole('option', { name: 'Doing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save — That column is not on this project’s board.');
    expect(within(row('MICO-1')).getByRole('button', { name: 'Status of MICO-1: To Do' })).toBeInTheDocument();
  });

  it('puts the people back when an assignment is refused', async () => {
    const user = userEvent.setup();
    show();
    await user.click(within(row('MICO-1')).getByRole('button', { name: /People on MICO-1/ }));
    const omar = await screen.findByRole('checkbox', { name: 'Omar Ahmed' });
    refuse = { status: 400, code: 'VALIDATION', message: 'Only active members of this project can be assigned.' };
    await user.click(omar);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save — Only active members of this project can be assigned.');
    expect(within(row('MICO-1')).getByRole('button', { name: 'People on MICO-1: Ada Lovelace' })).toBeInTheDocument();
  });

  it('a remembered status or person that is not on this table (another project’s column) is let go', () => {
    localStorage.setItem('mico360.u.u1.table.test', JSON.stringify({ sort: null, filters: { text: '', status: 'other-project-column', person: 'someone-elsewhere', priority: '', due: '' }, shown: [] }));
    show();
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Filter by status' })).toHaveTextContent('Any status');
    expect(screen.getByRole('button', { name: 'Filter by assignee' })).toHaveTextContent('Anyone');
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('a hidden column’s sort is let go (no order nobody can see)', () => {
    localStorage.setItem('mico360.u.u1.table.test', JSON.stringify({ sort: { column: 'start', dir: 'asc' }, filters: {}, shown: [] }));
    show({ tasks: [task({ id: 'a', key: 'MICO-1', title: 'Late start', startDate: '2026-12-01' }), task({ id: 'b', key: 'MICO-2', title: 'Early start', startDate: '2026-01-01' })] });
    expect(screen.getAllByRole('columnheader').some((h) => h.getAttribute('aria-sort'))).toBe(false);
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([expect.stringContaining('Late start'), expect.stringContaining('Early start')]);
  });

  it('can draw every row at once (My Tasks, whose Select all acts on what is shown)', () => {
    const many = Array.from({ length: 105 }, (_, i) => task({ id: `m${i}`, key: `MICO-${i + 10}`, title: `Task ${i}` }));
    show({ tasks: many, paged: false });
    expect(screen.getAllByRole('rowheader')).toHaveLength(105);
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
  });
});

describe('TaskTable — 1.23.5 Weight', () => {
  const WEIGHED = { ...PROJECT, completionMode: 'WEIGHT', weightNormal: 2, weightHigh: 3, weightLow: 1, weightUrgent: 4 } as unknown as ApiProject;

  it('a project counting by weight: a Weight column, each row’s own or its priority’s default, changed in place', async () => {
    const user = userEvent.setup();
    show({ projects: [WEIGHED], tasks: [task({ weight: 7 }), TASKS[1]!, TASKS[2]!] });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['No.', 'Title', 'Assignees', 'Priority', 'Weight', 'Due date', 'Status', 'Open']);
    expect(within(row('MICO-2')).getByRole('button', { name: 'Weight of MICO-2: default, 3' })).toHaveTextContent('Default (3)');
    await user.click(within(row('MICO-1')).getByRole('button', { name: 'Weight of MICO-1: 7' }));
    await user.click(await screen.findByRole('option', { name: '9 points' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ weight: 9 }));
    expect(within(row('MICO-1')).getByRole('button', { name: 'Weight of MICO-1: 9' })).toBeInTheDocument();
  });

  it('no project counting by weight: no Weight column', () => {
    show();
    expect(screen.queryByRole('columnheader', { name: 'Weight' })).toBeNull();
  });

  it('a read-only table shows the weight as words, the default marked', () => {
    show({ projects: [WEIGHED], tasks: [TASKS[0]!], readOnly: { reason: 'archived' } as never });
    expect(within(row('MICO-1')).getByText('(default)')).toBeInTheDocument();
  });
});

describe('Detailed rows in the Table view (1.23.8)', () => {
  it('detailed: the description’s first line and the tags go under the title (comfortable: neither)', async () => {
    const { useDensityStore } = await import('../../lib/density');
    const { act } = await import('@testing-library/react');
    const rich = task({ id: 't9', key: 'MICO-9', title: 'Check the scaffold', description: 'Ask Omar for the tag.\nThen sign.', tags: [{ id: 'g', name: 'Safety', color: '#8B1E1E' }] });
    const view = show({ tasks: [rich] });
    expect(within(row('MICO-9')).queryByTestId('card-description')).toBeNull();
    view.unmount();
    act(() => useDensityStore.getState().set('detailed'));
    try {
      show({ tasks: [rich] });
      expect(within(row('MICO-9')).getByTestId('card-description')).toHaveTextContent('Ask Omar for the tag.');
      expect(within(row('MICO-9')).getByTestId('card-tags')).toHaveTextContent('Safety');
    } finally {
      act(() => useDensityStore.getState().set('comfortable'));
    }
  });
});
