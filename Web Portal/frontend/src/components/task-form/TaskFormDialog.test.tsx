import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormDialog } from './TaskFormDialog';
import type { ApiTask } from '../../api/tasks';
import { useAuthStore } from '../../stores/auth-store';
import { windowWidth } from '../../test/window-width';
import { useTaskNotice } from '../../lib/task-notice';

// Files go up after the task is created; the test decides how each upload goes.
const uploads: Array<{ taskId: string; name: string; type: string }> = [];
let uploadReply: (file: File) => Promise<unknown> = async () => ({});
vi.mock('../../api/attachments', async (real) => ({
  ...(await real<typeof import('../../api/attachments')>()),
  attachmentsApi: () => ({
    upload: (taskId: string, file: File, onProgress?: (f: number) => void) => {
      uploads.push({ taskId, name: file.name, type: file.type });
      onProgress?.(1);
      return uploadReply(file);
    },
  }),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: 'rocket', ownerId: 'u1', clientName: null },
  { id: 'p2', code: 'OPS', name: 'Ops Board', status: 'ACTIVE', color: '#0F766E', icon: null, ownerId: null, clientName: null },
  { id: 'p3', code: 'OLD', name: 'Old Archive', status: 'ARCHIVED', color: '#475569', icon: null, ownerId: null, clientName: null },
  // Companies: its own status is Active, but all its companies are archived — it counts as archived.
  { id: 'p4', code: 'GAM', name: 'Gamma Plant', status: 'ACTIVE', archived: true, color: '#475569', icon: null, ownerId: null, clientName: null },
];
const COLUMNS: Record<string, unknown[]> = {
  p1: [
    { id: 'c1', projectId: 'p1', name: 'Backlog', category: 'TODO', position: 0, color: '#64748b', enabled: true },
    { id: 'c2', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '#2563eb', enabled: true },
    { id: 'c3', projectId: 'p1', name: 'Done', category: 'DONE', position: 2, color: '#16a34a', enabled: true },
  ],
  p2: [
    { id: 'd1', projectId: 'p2', name: 'To Do', category: 'TODO', position: 0, color: '#64748b', enabled: true },
    { id: 'd2', projectId: 'p2', name: 'In progress', category: 'IN_PROGRESS', position: 1, color: '#2563eb', enabled: true },
  ],
};
const person = (id: string, firstName: string, lastName: string, username: string) => ({ id, firstName, lastName, username, email: '', avatarUrl: null });
const MEMBERS: Record<string, unknown[]> = {
  p1: [person('u1', 'Mona', 'Owner', 'mona'), person('u9', 'Omar', 'A', 'omar'), person('u7', 'Sara', 'K', 'sara')],
  p2: [person('u7', 'Sara', 'K', 'sara')],
};

type Call = { url: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };
let calls: Call[];
let override: (url: string, method: string, body: Record<string, unknown> | null) => Response | Promise<Response> | undefined;
let parseReply: () => Response;

beforeEach(() => {
  localStorage.clear();
  calls = [];
  override = () => undefined;
  parseReply = () => json({ data: { title: 'Review the report', dueDate: '2026-10-16', priority: 'HIGH' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
      const o = await override(u, method, body);
      if (o) return o;
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: COLUMNS[cols[1]!] ?? [] });
      const mem = /\/projects\/(p\d)\/members/.exec(u);
      if (mem) return json({ data: MEMBERS[mem[1]!] ?? [] });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.endsWith('/users/directory')) return json({ data: (MEMBERS.p1 as unknown[]) });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      if (u.endsWith('/ai/parse-task')) return parseReply();
      if (u.endsWith('/tasks') && method === 'POST') return json({ data: { id: 't99', key: 'MICO-9', title: body?.title, projectId: body?.projectId, columnId: body?.columnId } }, 201);
      if (u.endsWith('/tasks/t1/assignees') && method === 'GET') return json({ data: [person('u9', 'Omar', 'A', 'omar')] });
      if (/\/tasks\/t1$/.test(u) && method === 'PUT') return json({ data: { ...TASK, ...body, version: 8 } });
      if (u.endsWith('/tasks/t1/move')) return json({ data: { ...TASK, columnId: body?.columnId } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TASK: ApiTask = {
  id: 't1', key: 'MICO-12', title: 'Prepare the vendor sheet', description: 'Collect quotes', projectId: 'p1', columnId: 'c1', columnCategory: 'TODO',
  position: 0, priority: 'NORMAL', startDate: null, dueDate: '2026-10-20T00:00:00.000Z', progress: 0, completedAt: null, createdAt: '', updatedAt: '', version: 7,
  recurrenceRule: null, recurrenceParentId: null, recurrenceNextId: null,
} as ApiTask;

function renderDialog(props: Partial<React.ComponentProps<typeof TaskFormDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <TaskFormDialog onClose={onClose} onCreated={onCreated} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onClose, onCreated, onSaved };
}
const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/tasks'));
const ready = async () => waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
async function pick(trigger: string, option: string | RegExp) {
  await userEvent.click(screen.getByRole('button', { name: trigger }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}
async function addPerson(query: string, name: string) {
  const box = screen.getByRole('combobox', { name: 'Add people' });
  await userEvent.click(box);
  await userEvent.type(box, query);
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('New task form', () => {
  it('is a wide dialog with a header, a scrolling body and a footer that stays in view', async () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(within(dialog).getByRole('heading', { name: 'New task' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    // A big form on the shared scale (1.22): 720px on a tablet, 960px from 1024px.
    expect(dialog.className).toMatch(/sm:max-w-\[45rem\] lg:max-w-\[60rem\]/);
    expect(dialog.className).toMatch(/sm:max-h-\[calc\(var\(--visible-height\)-2rem\)\]/);
    const body = screen.getByLabelText(/^task title/i).closest('.overflow-y-auto')!;
    expect(body).not.toBeNull();
    expect(body.contains(screen.getByRole('button', { name: 'Create task' }))).toBe(false);
    expect(body.contains(screen.getByRole('button', { name: 'Cancel' }))).toBe(false);
    expect(screen.getByLabelText(/^task title/i)).toHaveAttribute('aria-required', 'true');
    expect((screen.getByLabelText(/^description/i) as HTMLTextAreaElement).rows).toBeGreaterThanOrEqual(5);
  });

  it('creates the task with its people in one request, with an Idempotency-Key', async () => {
    const { onCreated, onClose } = renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Ship it');
    await addPerson('om', 'Omar A');
    expect(screen.getByRole('button', { name: 'Remove Omar A' })).toBeInTheDocument();
    await addPerson('sa', 'Sara K');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ projectId: 'p1', columnId: 'c1', title: 'Ship it', priority: 'NORMAL', assigneeIds: ['u9', 'u7'] });
    expect(posts()[0]!.headers['Idempotency-Key']).toBeTruthy();
    expect(calls.some((c) => c.url.includes('/assignees'))).toBe(false);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    // 1.22.3: "Task MICO-143 created", with Open (the app's toast shows it, wherever the form was opened).
    const created = onCreated.mock.calls[0]![0] as ApiTask;
    expect(useTaskNotice.getState().notice).toEqual({ text: `Task ${created.key} created`, taskId: created.id, key: created.key });
  });

  it('a new task can need approval (ticked here, sent with it)', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Client datasheet');
    const box = screen.getByRole('checkbox', { name: /needs approval/i });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ title: 'Client datasheet', needsApproval: true });
  });

  it('a project whose new tasks need approval starts the box ticked; its manager may untick it, and the task says so', async () => {
    override = (u) => (u.endsWith('/projects') ? json({ data: PROJECTS.map((p) => (p.id === 'p1' ? { ...p, newTasksNeedApproval: true, canManage: true } : p)) }) : undefined);
    renderDialog();
    await ready();
    const box = await screen.findByRole('checkbox', { name: /needs approval/i });
    await waitFor(() => expect(box).toBeChecked());
    expect(box).toBeEnabled();
    expect(screen.queryByText('Only the project’s managers can turn this off.')).toBeNull();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Quick note');
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ needsApproval: false });
  });

  it('in a project whose new tasks need approval, someone who doesn’t run it gets the box locked on, and hears why (owner, 30 Oct)', async () => {
    override = (u) => (u.endsWith('/projects') ? json({ data: PROJECTS.map((p) => (p.id === 'p1' ? { ...p, newTasksNeedApproval: true, canManage: false } : p)) }) : undefined);
    renderDialog();
    await ready();
    const box = await screen.findByRole('checkbox', { name: /needs approval/i });
    await waitFor(() => expect(box).toBeChecked());
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription('A project manager must approve it before it counts as done. Only the project’s managers can turn this off.');
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Quick note');
    await userEvent.click(box);
    expect(box).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ needsApproval: true });
  });

  it('ticked and unticked in a project that doesn’t tick its tasks, then moved to one that does: locked on there for someone who doesn’t run it', async () => {
    override = (u) => (u.endsWith('/projects') ? json({ data: PROJECTS.map((p) => (p.id === 'p2' ? { ...p, newTasksNeedApproval: true, canManage: false } : p)) }) : undefined);
    renderDialog();
    await ready();
    const box = screen.getByRole('checkbox', { name: /needs approval/i });
    await userEvent.click(box);
    await userEvent.click(box);
    expect(box).not.toBeChecked();
    expect(box).toBeEnabled();
    await pick('Project', /Ops Board/);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /needs approval/i })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /needs approval/i })).toBeDisabled();
  });

  it('marks a new task as a milestone of its project', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Go-live');
    await userEvent.click(screen.getByRole('checkbox', { name: /milestone/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ title: 'Go-live', isMilestone: true });
  });

  it('leaves people out when nobody is picked, and says the project owner gets it', async () => {
    renderDialog();
    await ready();
    expect(await screen.findByText(/nobody picked — the task will go to Mona Owner, the project owner/i)).toBeInTheDocument();
    await addPerson('om', 'Omar A');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Omar A' }));
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Solo');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).not.toHaveProperty('assigneeIds');
  });

  it('switching project updates its columns (keeping the kind of column) and drops people not on it', async () => {
    renderDialog();
    await ready();
    await pick('Column', 'Doing');
    await addPerson('om', 'Omar A');
    await addPerson('sa', 'Sara K');
    await userEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(screen.queryByRole('option', { name: /Old Archive/ })).not.toBeInTheDocument(); // archived: no new tasks
    expect(screen.queryByRole('option', { name: /Gamma Plant/ })).not.toBeInTheDocument(); // its companies archived: neither
    expect(screen.getByRole('option', { name: /MICO360 Platform/ }).querySelector('[data-project-avatar="icon"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('option', { name: /Ops Board/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('In progress'));
    expect(screen.getByRole('status')).toHaveTextContent('Omar A isn’t on Ops Board, so they were taken off this task.');
    expect(screen.queryByRole('button', { name: 'Remove Omar A' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Sara K' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Moved');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ projectId: 'p2', columnId: 'd2', assigneeIds: ['u7'] });
  });

  it('sets priority and due date, and reveals the repeat options with a plain summary', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Weekly report');
    await pick('Priority', 'High');
    fireEvent.change(screen.getByLabelText(/^due date/i), { target: { value: '2026-10-01' } });
    expect(screen.queryByRole('group', { name: 'Repeat schedule' })).not.toBeInTheDocument();
    await pick('Repeat', 'Weekly');
    const schedule = screen.getByRole('group', { name: 'Repeat schedule' });
    expect(within(schedule).getByText(/^Repeats every week on Thu$/)).toBeInTheDocument();
    expect(within(schedule).getByLabelText('Repeat every')).toHaveValue(1);
    expect(within(schedule).getByRole('button', { name: 'Thu' })).toHaveAttribute('aria-pressed', 'true'); // the due date's day
    await userEvent.click(within(schedule).getByRole('button', { name: 'Mon' }));
    await userEvent.selectOptions(within(schedule).getByLabelText('Ends'), 'COUNT');
    fireEvent.change(within(schedule).getByLabelText('Number of occurrences'), { target: { value: '5' } });
    expect(within(schedule).getByText(/^Repeats every week on Mon, Thu, 5 times$/)).toBeInTheDocument();
    expect(within(schedule).getByText(/^Next:/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ title: 'Weekly report', priority: 'HIGH', dueDate: '2026-10-01', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1, 4], count: 5 } });
  });

  it('will not save a repeat that ends before the due date', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Bad repeat');
    fireEvent.change(screen.getByLabelText(/^due date/i), { target: { value: '2026-10-20' } });
    await pick('Repeat', 'Daily');
    await userEvent.selectOptions(screen.getByLabelText('Ends'), 'UNTIL');
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('The repeat can’t end before the due date.')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('does not send a task without a title, and says so at the title', async () => {
    renderDialog();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Give the task a title.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^task title/i)).toHaveFocus();
    expect(screen.getByLabelText(/^task title/i)).toHaveAttribute('aria-invalid', 'true');
    expect(posts()).toHaveLength(0);
  });

  it('keeps everything after a failed save, and sends only once however often it is pressed', async () => {
    let fail = true;
    let release: () => void = () => {};
    override = (u, m) => {
      if (!(u.endsWith('/tasks') && m === 'POST')) return undefined;
      if (fail) return json({ error: { code: 'INTERNAL', message: 'The database is busy.' } }, 500);
      return new Promise<Response>((r) => { release = () => r(json({ data: { id: 't99', key: 'MICO-9' } }, 201)); });
    };
    const { onCreated } = renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Keep me');
    await userEvent.type(screen.getByLabelText(/^description/i), 'All of this');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t create the task. The database is busy.');
    expect(screen.getByLabelText(/^task title/i)).toHaveValue('Keep me');
    expect(screen.getByLabelText(/^description/i)).toHaveValue('All of this');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const busy = await screen.findByRole('button', { name: 'Creating…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(busy);
    fireEvent.submit(screen.getByLabelText(/^task title/i).closest('form')!);
    release();
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(posts()).toHaveLength(2); // the failed one and one retry — never a duplicate
  });

  it('asks before throwing away what was typed (Cancel, Escape or the close button)', async () => {
    const { onClose } = renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Half done');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Discard this task?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText(/^task title/i)).toHaveValue('Half done');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes at once when nothing was typed — a day chosen on the calendar does not count', async () => {
    const { onClose } = renderDialog({ defaultDueDate: '2026-10-22' });
    await ready();
    expect(screen.getByLabelText(/^due date/i)).toHaveValue('2026-10-22');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('on a board: the project is fixed and shown, the chosen column and board day are used', async () => {
    renderDialog({ projectId: 'p1', defaultColumnId: 'c2', boardDate: '2026-10-09' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Doing'));
    expect(screen.queryByRole('button', { name: 'Project' })).not.toBeInTheDocument();
    expect(screen.getByText('MICO360 Platform')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Board task');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ projectId: 'p1', columnId: 'c2', boardDate: '2026-10-09' });
  });

  it('from a status on the All projects board: starts in that kind of column, in whichever project is chosen', async () => {
    localStorage.setItem('mico360.newTask.project', 'p2');
    renderDialog({ defaultColumnCategory: 'IN_PROGRESS', boardDate: '2026-10-09' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('In progress'));
    expect(screen.getByRole('button', { name: 'Project' })).toBeInTheDocument(); // the project can be changed
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Combined board task');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ projectId: 'p2', columnId: 'd2', boardDate: '2026-10-09' });
  });

  it('starts in the project used last time', async () => {
    localStorage.setItem('mico360.newTask.project', 'p2');
    renderDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Ops Board'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('To Do'));
  });

  it('starts in the project of the page it was opened from, over the one used last time — and it can still be changed', async () => {
    localStorage.setItem('mico360.newTask.project', 'p2');
    renderDialog({ defaultProjectId: 'p1' });
    const picker = () => screen.getByRole('button', { name: 'Project' });
    await waitFor(() => expect(picker()).toHaveTextContent('MICO360 Platform'));
    // Its own columns follow (MICO360 Platform starts with Backlog).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
    // Not locked like a board's own "New task": another project can be picked.
    expect(picker()).toBeEnabled();
    await userEvent.click(picker());
    await userEvent.click(await screen.findByRole('option', { name: /Ops Board/ }));
    await waitFor(() => expect(picker()).toHaveTextContent('Ops Board'));
  });

  it('ignores the page’s project when it is archived (or unknown), and uses the one used last time', async () => {
    localStorage.setItem('mico360.newTask.project', 'p2');
    renderDialog({ defaultProjectId: 'p3' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Ops Board'));
  });

  // 1.22 "Show my projects only": the page's project may be off an administrator's own list (a board
  // opened by its link) — the task still starts there, not silently in another project.
  it('starts in the page’s project when an administrator’s own list leaves it out', async () => {
    useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    localStorage.setItem('mico360.newTask.project', 'p2');
    override = (u) => (/\/projects\/p7$/.test(u) ? json({ data: { ...PROJECTS[0], id: 'p7', code: 'FAR', name: 'Far Away Works' } }) : undefined);
    try {
      renderDialog({ defaultProjectId: 'p7' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Far Away Works'));
    } finally {
      useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    }
  });

  it('says so when there are no projects to add a task to, and leads to making one instead of an unusable form', async () => {
    override = (u) => (u.endsWith('/projects') ? json({ data: [] }) : undefined);
    renderDialog();
    expect(await screen.findByText(/create a project first/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/projects?new=1');
    // No fields to fill and no Create task button that can't work.
    expect(screen.queryByRole('button', { name: 'Create task' })).toBeNull();
    expect(screen.queryByLabelText(/task title/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

describe('Describe it in plain English', () => {
  it('reads a description (company "today"), shows what it found, and fills the chosen details', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T21:30:00Z')); // already Sep 27 in Muscat
    renderDialog();
    await ready();
    const text = screen.getByLabelText(/describe it in plain english/i);
    expect(text.tagName).toBe('TEXTAREA');
    await userEvent.type(text, 'review the report by Friday, high priority');
    await userEvent.click(screen.getByRole('button', { name: 'Fill task details' }));
    const found = await screen.findByRole('group', { name: 'Suggested details' });
    const parse = calls.find((c) => c.url.endsWith('/ai/parse-task'))!;
    expect(parse.body).toMatchObject({ text: 'review the report by Friday, high priority', today: '2026-09-27' });
    expect(within(found).getByRole('checkbox', { name: /title: review the report/i })).toBeChecked();
    expect(within(found).getByRole('checkbox', { name: /due date: .*16/i })).toBeChecked();
    expect(within(found).getByRole('checkbox', { name: /priority: high/i })).toBeChecked();
    expect(screen.getByLabelText(/^task title/i)).toHaveValue(''); // nothing changes before you choose
    await userEvent.click(within(found).getByRole('button', { name: 'Use selected details' }));
    expect(screen.getByLabelText(/^task title/i)).toHaveValue('Review the report');
    expect(screen.getByLabelText(/^due date/i)).toHaveValue('2026-10-16');
    expect(screen.getByRole('button', { name: 'Priority' })).toHaveTextContent('High');
    expect(screen.queryByRole('group', { name: 'Suggested details' })).not.toBeInTheDocument();
  });

  it('never silently replaces what you typed yourself', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'My own title');
    await pick('Priority', 'Urgent');
    await userEvent.type(screen.getByLabelText(/describe it in plain english/i), 'review the report by Friday');
    await userEvent.click(screen.getByRole('button', { name: 'Fill task details' }));
    const found = await screen.findByRole('group', { name: 'Suggested details' });
    const title = within(found).getByRole('checkbox', { name: /title: review the report/i });
    expect(title).not.toBeChecked();
    expect(found).toHaveTextContent('Replaces “My own title”');
    expect(within(found).getByRole('checkbox', { name: /priority: high/i })).not.toBeChecked();
    expect(within(found).getByRole('checkbox', { name: /due date/i })).toBeChecked();
    await userEvent.click(within(found).getByRole('button', { name: 'Use selected details' }));
    expect(screen.getByLabelText(/^task title/i)).toHaveValue('My own title');
    expect(screen.getByRole('button', { name: 'Priority' })).toHaveTextContent('Urgent');
    expect(screen.getByLabelText(/^due date/i)).toHaveValue('2026-10-16');
  });

  const fuller = () =>
    json({
      data: {
        title: 'Send the site report',
        description: 'Include the inspection photos.',
        dueDate: '2026-10-19',
        priority: null,
        recurrence: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
        project: { id: 'p2', code: 'OPS', number: 'PDO-7', name: 'Ops Board' },
      },
    });

  it('also suggests a description, a repeat and the project, and fills them in', async () => {
    parseReply = fuller;
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/describe it in plain english/i), 'send the OPS site report every monday with photos');
    await userEvent.click(screen.getByRole('button', { name: 'Fill task details' }));
    const found = await screen.findByRole('group', { name: 'Suggested details' });
    expect(within(found).getByRole('checkbox', { name: 'Description: Include the inspection photos.' })).toBeChecked();
    expect(within(found).getByRole('checkbox', { name: /^Repeat: Repeats every week on Mon$/ })).toBeChecked();
    expect(within(found).getByRole('checkbox', { name: 'Project: Ops Board · OPS · PDO-7' })).toBeChecked();
    expect(found).toHaveTextContent('Replaces MICO360 Platform');
    await userEvent.click(within(found).getByRole('button', { name: 'Use selected details' }));
    expect(screen.getByLabelText(/^description/i)).toHaveValue('Include the inspection photos.');
    expect(screen.getByRole('button', { name: 'Repeat' })).toHaveTextContent('Weekly');
    expect(within(screen.getByRole('group', { name: 'Repeat schedule' })).getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Project' })).toHaveTextContent('Ops Board');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('To Do'));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({
      projectId: 'p2',
      columnId: 'd1',
      title: 'Send the site report',
      description: 'Include the inspection photos.',
      dueDate: '2026-10-19',
      recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
    });
  });

  it('does not offer another project on a board, where the project is fixed', async () => {
    parseReply = fuller;
    renderDialog({ projectId: 'p1', defaultColumnId: 'c1' });
    await ready();
    await userEvent.type(screen.getByLabelText(/describe it in plain english/i), 'send the OPS site report every monday');
    await userEvent.click(screen.getByRole('button', { name: 'Fill task details' }));
    const found = await screen.findByRole('group', { name: 'Suggested details' });
    expect(within(found).queryByRole('checkbox', { name: /^project:/i })).not.toBeInTheDocument();
    expect(within(found).getByRole('checkbox', { name: /^repeat:/i })).toBeInTheDocument();
  });

  it('never silently replaces a project, description or repeat you chose yourself', async () => {
    parseReply = fuller;
    renderDialog();
    await ready();
    await pick('Project', /Ops Board/);
    await pick('Project', /MICO360 Platform/);
    await userEvent.type(screen.getByLabelText(/^description/i), 'My own notes');
    await pick('Repeat', 'Daily');
    await userEvent.type(screen.getByLabelText(/describe it in plain english/i), 'send the OPS site report every monday');
    await userEvent.click(screen.getByRole('button', { name: 'Fill task details' }));
    const found = await screen.findByRole('group', { name: 'Suggested details' });
    expect(within(found).getByRole('checkbox', { name: /^project:/i })).not.toBeChecked();
    expect(within(found).getByRole('checkbox', { name: /^description:/i })).not.toBeChecked();
    expect(within(found).getByRole('checkbox', { name: /^repeat:/i })).not.toBeChecked();
    expect(found).toHaveTextContent('Replaces “My own notes”');
  });

  it('ignores a project that is not in your list', async () => {
    parseReply = () => json({ data: { title: 'X', project: { id: 'p9', code: 'SEC', number: null, name: 'Secret' } } });
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/describe it in plain english/i), 'x for SEC');
    await userEvent.click(screen.getByRole('button', { name: 'Fill task details' }));
    const found = await screen.findByRole('group', { name: 'Suggested details' });
    expect(within(found).queryByRole('checkbox', { name: /^project:/i })).not.toBeInTheDocument();
  });

  it('shows progress while reading and a clear message when it fails, keeping the text', async () => {
    let answer: (r: Response) => void = () => {};
    parseReply = () => new Promise<Response>((r) => { answer = r; }) as unknown as Response;
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/describe it in plain english/i), 'something vague');
    await userEvent.click(screen.getByRole('button', { name: 'Fill task details' }));
    expect(await screen.findByRole('button', { name: 'Reading…' })).toHaveAttribute('aria-busy', 'true');
    answer(json({ error: { code: 'AI_UNAVAILABLE', message: 'The AI assistant is turned off.' } }, 503));
    expect(await screen.findByRole('alert')).toHaveTextContent('The AI assistant is turned off.');
    expect(screen.getByLabelText(/describe it in plain english/i)).toHaveValue('something vague');
    expect(screen.getByLabelText(/^task title/i)).toHaveValue('');
  });
});

describe('Edit task form', () => {
  it('opens filled in, with the project shown but not changeable and no description reader', async () => {
    renderDialog({ task: TASK });
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    expect(within(dialog).getByText('MICO-12')).toBeInTheDocument();
    expect(screen.getByLabelText(/^task title/i)).toHaveValue('Prepare the vendor sheet');
    expect(screen.getByLabelText(/^description/i)).toHaveValue('Collect quotes');
    expect(screen.getByLabelText(/^due date/i)).toHaveValue('2026-10-20');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
    expect(await screen.findByRole('button', { name: 'Remove Omar A' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Project' })).not.toBeInTheDocument();
    expect(screen.getByText('MICO360 Platform')).toBeInTheDocument();
    expect(screen.queryByLabelText(/describe it in plain english/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('saves only what changed: fields (with the version read), the column, and who is assigned', async () => {
    const { onSaved, onClose } = renderDialog({ task: TASK });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    await userEvent.clear(screen.getByLabelText(/^task title/i));
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Prepare the vendor list');
    await pick('Column', 'Doing');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Omar A' }));
    await addPerson('sa', 'Sara K');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({ title: 'Prepare the vendor list', expectedVersion: 7 });
    expect(calls.find((c) => c.url.endsWith('/tasks/t1/move'))!.body).toMatchObject({ columnId: 'c2' });
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks/t1/assignees'))!.body).toEqual({ userIds: ['u7'] });
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/tasks/t1/assignees/u9'))).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('ticks or unticks "Needs approval" (only what changed is sent)', async () => {
    const { onSaved } = renderDialog({ task: TASK });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    const box = screen.getByRole('checkbox', { name: /needs approval/i });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription('A project manager must approve it before it counts as done.');
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ needsApproval: true, expectedVersion: 7 });
  });

  it('the tick and a new status in one Save go in one request (the server judges them together)', async () => {
    const { onSaved } = renderDialog({ task: TASK });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    await userEvent.click(screen.getByRole('checkbox', { name: /needs approval/i }));
    await pick('Column', 'Doing');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ needsApproval: true, columnId: 'c2', expectedVersion: 7 });
    expect(calls.some((c) => c.url.endsWith('/tasks/t1/move'))).toBe(false);
  });

  it('a task waiting for approval: only a project manager can untick it here', async () => {
    const waiting = { ...TASK, needsApproval: true, approvalRequestedAt: '2026-10-30T08:00:00Z', approval: { canApprove: false, requestedBy: null, approvedBy: null, approverName: null } };
    renderDialog({ task: waiting });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    expect(screen.getByRole('checkbox', { name: /needs approval/i })).toBeDisabled();
    expect(screen.getByText('Only the project’s managers can turn this off.')).toBeInTheDocument();
  });

  it('a ticked task (not waiting), for someone who doesn’t run the project: shown ticked, can’t be unticked, says why (owner, 30 Oct)', async () => {
    const { onSaved } = renderDialog({ task: { ...TASK, needsApproval: true, approval: { canApprove: false, requestedBy: null, approvedBy: null, approverName: null } } });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    const box = screen.getByRole('checkbox', { name: /needs approval/i });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription('A project manager must approve it before it counts as done. Only the project’s managers can turn this off.');
    await userEvent.clear(screen.getByLabelText(/^task title/i));
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Vendor sheet');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ title: 'Vendor sheet', expectedVersion: 7 });
  });

  it('a ticked task, for whoever runs the project: it can be unticked', async () => {
    const { onSaved } = renderDialog({ task: { ...TASK, needsApproval: true, approval: { canApprove: true, requestedBy: null, approvedBy: null, approverName: null } } });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    const box = screen.getByRole('checkbox', { name: /needs approval/i });
    expect(box).toBeEnabled();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ needsApproval: false, expectedVersion: 7 });
  });

  it('a ticked task opened without its approval details: the project’s canManage decides', async () => {
    override = (u) => (u.endsWith('/projects') ? json({ data: PROJECTS.map((p) => (p.id === 'p1' ? { ...p, canManage: true } : p)) }) : undefined);
    renderDialog({ task: { ...TASK, needsApproval: true } });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /needs approval/i })).toBeEnabled());
  });

  it('an administrator can untick it, whatever the project says', async () => {
    useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    try {
      renderDialog({ task: { ...TASK, needsApproval: true } });
      await screen.findByRole('button', { name: 'Remove Omar A' });
      expect(screen.getByRole('checkbox', { name: /needs approval/i })).toBeEnabled();
    } finally {
      useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    }
  });

  it('turns a task into a milestone, and back', async () => {
    const { onSaved } = renderDialog({ task: { ...TASK, isMilestone: true } });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    const box = screen.getByRole('checkbox', { name: /milestone/i });
    expect(box).toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ isMilestone: false, expectedVersion: 7 });
  });

  it('says when someone else changed the task meanwhile, and keeps the edits', async () => {
    override = (u, m) => (/\/tasks\/t1$/.test(u) && m === 'PUT' ? json({ error: { code: 'VERSION_CONFLICT', message: 'Version conflict' } }, 409) : undefined);
    renderDialog({ task: TASK });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    await userEvent.type(screen.getByLabelText(/^description/i), ' and compare');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/someone else changed this task/i);
    expect(screen.getByLabelText(/^description/i)).toHaveValue('Collect quotes and compare');
  });

  it('a refusal says the server’s own reason; a refusal without one says it plainly', async () => {
    const REASON = 'Only the project’s managers can turn off approval for this task.';
    let reason: string | undefined = REASON;
    override = (u, m) => (/\/tasks\/t1$/.test(u) && m === 'PUT' ? json({ error: { code: 'FORBIDDEN', ...(reason ? { message: reason } : {}) } }, 403) : undefined);
    renderDialog({ task: TASK });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    await userEvent.type(screen.getByLabelText(/^description/i), ' and compare');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`Couldn’t save the changes. ${REASON}`);
    reason = undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save the changes. You don’t have permission to do that.'));
  });

  it('on a repeating task, can apply the edit to the whole series', async () => {
    renderDialog({ task: { ...TASK, recurrenceRule: { freq: 'WEEKLY', interval: 1 } } });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    expect(screen.getByRole('group', { name: 'Repeat schedule' })).toHaveTextContent(/Repeats every week/);
    // Says what the server copies to the other copies (title, description, priority), never the dates.
    const applyTo = screen.getByRole('group', { name: 'Apply changes to' });
    expect(applyTo).toHaveTextContent('The title, description and priority go to every copy when you choose the series; dates change on this copy only.');
    await pick('Priority', 'High');
    await userEvent.click(screen.getByRole('radio', { name: 'Entire series' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ priority: 'HIGH', scope: 'series' });
  });

  it('an earlier copy of a series cannot change the repeat', async () => {
    renderDialog({ task: { ...TASK, recurrenceRule: { freq: 'WEEKLY', interval: 1 }, recurrenceNextId: 't2' } });
    expect(await screen.findByText(/an earlier copy of a repeating series — change the repeat on its newest copy/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Repeat' })).not.toBeInTheDocument();
  });

  it('closes at once when nothing changed', async () => {
    const { onClose } = renderDialog({ task: TASK });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('New task form — files', () => {
  beforeEach(() => {
    uploads.length = 0;
    uploadReply = async () => ({});
  });
  const png = (name = 'image.png') => new File(['png-bytes'], name, { type: 'image/png' });
  const clipboard = (files: File[], text = '') => ({
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: [...(files.length ? ['Files'] : []), ...(text ? ['text/plain'] : [])],
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  });

  it('attaches the chosen files to the new task once it is created, then closes', async () => {
    const { onCreated, onClose } = renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Inspect the pump');
    await userEvent.upload(screen.getByLabelText('Attach files'), [new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' }), png('site.png')]);
    expect(screen.getByText('spec.pdf')).toBeInTheDocument();
    expect(screen.getByText('site.png')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(uploads).toEqual([
      { taskId: 't99', name: 'spec.pdf', type: 'application/pdf' },
      { taskId: 't99', name: 'site.png', type: 'image/png' },
    ]);
    expect(onCreated).toHaveBeenCalled();
  });

  it('a picture pasted into the form (Ctrl+V) is added to its files, named by when it was pasted', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Fix the leak');
    fireEvent.paste(screen.getByLabelText(/^description/i), { clipboardData: clipboard([png()]) });
    expect(screen.getByText(/^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]!.name).toMatch(/^Pasted image /);
  });

  it('text pasted into a field stays text, even with a picture on the clipboard', async () => {
    renderDialog();
    await ready();
    fireEvent.paste(screen.getByLabelText(/^description/i), { clipboardData: clipboard([png()], 'Qty\tPrice') });
    expect(screen.queryByText(/^Pasted image/)).not.toBeInTheDocument();
  });

  it('a file can be taken off before creating; files count as something to keep', async () => {
    const { onClose } = renderDialog();
    await ready();
    await userEvent.upload(screen.getByLabelText('Attach files'), png('wrong.png'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove wrong.png' }));
    expect(screen.queryByText('wrong.png')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'No files');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(uploads).toEqual([]);
  });

  it('says which file couldn’t be attached and why; the task is already created, and Done closes', async () => {
    uploadReply = async (file) => {
      if (file.name === 'big.zip') throw new Error('That file is too large to upload.');
      return {};
    };
    const { onCreated, onClose } = renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Send the logs');
    await userEvent.upload(screen.getByLabelText('Attach files'), [png('ok.png'), new File(['x'], 'big.zip', { type: 'application/zip' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The task was created, but big.zip wasn’t attached: That file is too large to upload.');
    expect(posts()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(posts()).toHaveLength(1); // never a second task
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('offline, a task with files is not put aside to send later: files need a connection', async () => {
    override = (u, method) => (u.endsWith('/tasks') && method === 'POST' ? Promise.reject(new TypeError('Failed to fetch')) : undefined);
    const onQueued = vi.fn();
    const { onClose } = renderDialog({ onQueued });
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Offline with a photo');
    await userEvent.upload(screen.getByLabelText('Attach files'), png('photo.png'));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText(/files can’t be attached offline/i)).toBeInTheDocument();
    expect(onQueued).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('editing a task has no files box (they are in the task panel)', async () => {
    renderDialog({ task: TASK });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.queryByLabelText('Attach files')).not.toBeInTheDocument();
  });
});

describe('New task form — a project whose new tasks are due today', () => {
  const NOTE = 'Due today (this project’s setting)';
  beforeEach(() => {
    // MICO360 Platform gives new tasks without a date today's date; Ops Board doesn't.
    override = (u) => (u.endsWith('/projects') ? json({ data: PROJECTS.map((p) => (p.id === 'p1' ? { ...p, defaultDueToday: true } : p)) }) : undefined);
  });

  it('says so next to an empty due date, and sends the task without one (the server gives it today)', async () => {
    renderDialog();
    await ready();
    const due = screen.getByLabelText(/^due date/i);
    expect(due).toHaveValue('');
    expect(due).toHaveAccessibleDescription(NOTE);
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Call the client');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).not.toHaveProperty('dueDate');
  });

  it('a picked date is kept: the note goes, and comes back when the date is cleared', async () => {
    renderDialog();
    await ready();
    const due = screen.getByLabelText(/^due date/i);
    fireEvent.change(due, { target: { value: '2026-11-05' } });
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    fireEvent.change(due, { target: { value: '' } });
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    fireEvent.change(due, { target: { value: '2026-11-05' } });
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Call the client');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ dueDate: '2026-11-05' });
  });

  it('follows the chosen project: nothing for a project without the setting', async () => {
    renderDialog();
    await ready();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    await pick('Project', /Ops Board/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('To Do'));
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^due date/i)).not.toHaveAccessibleDescription(NOTE);
  });

  it('editing a task never says it: a date cleared on purpose stays cleared', async () => {
    renderDialog({ task: { ...TASK, dueDate: null } });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    expect(screen.getByLabelText(/^due date/i)).toHaveValue('');
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});

describe('New task form — the date a due-today project will give, from the board day', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T06:00:00Z')); // Fri 23 Oct, 10:00 in Muscat
    override = (u) => (u.endsWith('/projects') ? json({ data: PROJECTS.map((p) => (p.id === 'p1' ? { ...p, defaultDueToday: true } : p)) }) : undefined);
  });

  it('added from a later day’s board, it names that day (and the server is left to set it)', async () => {
    renderDialog({ projectId: 'p1', defaultColumnId: 'c1', boardDate: '2026-10-27' });
    await ready();
    expect(screen.getByLabelText(/^due date/i)).toHaveAccessibleDescription('Due Tue 27 Oct (this project’s setting)');
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Site visit');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ boardDate: '2026-10-27' });
    expect(posts()[0]!.body).not.toHaveProperty('dueDate');
  });

  it('added from today’s board or a past day’s, it is due today', async () => {
    renderDialog({ projectId: 'p1', defaultColumnId: 'c1', boardDate: '2026-10-20' });
    await ready();
    expect(screen.getByLabelText(/^due date/i)).toHaveAccessibleDescription('Due today (this project’s setting)');
  });

  it('the repeat preview starts from the date the task will get: the board day', async () => {
    renderDialog({ projectId: 'p1', defaultColumnId: 'c1', boardDate: '2026-10-27' });
    await ready();
    await pick('Repeat', 'Weekly');
    const schedule = screen.getByRole('group', { name: 'Repeat schedule' });
    expect(within(schedule).getByText(/^Repeats every week on Tue$/)).toBeInTheDocument();
    expect(within(schedule).getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(schedule).getByText(/^Next:/)).toBeInTheDocument();
    expect(within(schedule).queryByText('Set a due date to see the next dates.')).not.toBeInTheDocument();
  });

  it('…or today, without a board day', async () => {
    renderDialog();
    await ready();
    await pick('Repeat', 'Weekly');
    const schedule = screen.getByRole('group', { name: 'Repeat schedule' });
    expect(within(schedule).getByText(/^Repeats every week on Fri$/)).toBeInTheDocument();
    expect(within(schedule).getByText(/^Next:/)).toBeInTheDocument();
  });

  it('a project without the setting still asks for a date to show the next dates', async () => {
    renderDialog();
    await ready();
    await pick('Project', /Ops Board/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('To Do'));
    await pick('Repeat', 'Weekly');
    expect(within(screen.getByRole('group', { name: 'Repeat schedule' })).getByText('Set a due date to see the next dates.')).toBeInTheDocument();
  });
});

describe('Task form — an inspection form (a check)', () => {
  const FORMS = [
    { id: 'f1', title: 'Rig daily check', description: null, structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, version: 1, sectionCount: 2, itemCount: 12, createdBy: null, updatedAt: '', canEdit: false },
  ];
  beforeEach(() => {
    override = (url) => (url.endsWith('/inspection-forms') ? json({ data: { forms: FORMS, canCreate: false } }) : undefined);
  });

  it('a new task can carry a form and a place; turning on Repeat then makes the checks on schedule', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Daily rig check');
    expect(screen.queryByRole('textbox', { name: 'Place (optional)' })).toBeNull();
    await pick('Inspection form', /Rig daily check/);
    await userEvent.type(screen.getByRole('textbox', { name: 'Place (optional)' }), 'Rig 3 – الحفار');
    expect(screen.getByRole('textbox', { name: 'Place (optional)' })).toHaveAttribute('dir', 'auto');
    await pick('Repeat', 'Daily');
    expect(screen.queryByLabelText('Create the next copy')).toBeNull();
    expect(screen.getByText('Each check is made on its date, done or not.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ title: 'Daily rig check', inspectionFormId: 'f1', inspectionPlace: 'Rig 3 – الحفار', recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' } });
  });

  it('Repeat first, then the form: still made on each date (the order doesn’t matter)', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Daily rig check');
    await pick('Repeat', 'Daily');
    expect(screen.getByLabelText('Create the next copy')).toHaveValue('ON_COMPLETE');
    await pick('Inspection form', /Rig daily check/);
    expect(screen.queryByLabelText('Create the next copy')).toBeNull();
    expect(screen.getByText('Each check is made on its date, done or not.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ inspectionFormId: 'f1', recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' } });
  });

  it('without a form nothing changes: no form sent, and a repeat still waits for the task to be done', async () => {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Weekly report');
    await pick('Repeat', 'Weekly');
    expect(screen.getByLabelText('Create the next copy')).toHaveValue('ON_COMPLETE');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).not.toHaveProperty('inspectionFormId');
  });

  it('editing: shows the form it carries (even one deleted since), changes the place, and can take the form off', async () => {
    renderDialog({ task: { ...TASK, inspectionFormId: 'f-old', inspectionPlace: 'Rig 3', inspectionForm: { id: 'f-old', title: 'Old deck check', deleted: true } } });
    await ready();
    expect(screen.getByRole('button', { name: 'Inspection form' })).toHaveTextContent('Old deck check (deleted)');
    const place = screen.getByRole('textbox', { name: 'Place (optional)' });
    await userEvent.clear(place);
    await userEvent.type(place, 'Rig 4');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ inspectionPlace: 'Rig 4' });
    expect(calls.find((c) => c.method === 'PUT')!.body).not.toHaveProperty('inspectionFormId');
  });

  it('editing: taking the form off sends no form and no place', async () => {
    renderDialog({ task: { ...TASK, inspectionFormId: 'f1', inspectionPlace: 'Rig 3', inspectionForm: { id: 'f1', title: 'Rig daily check', deleted: false } } });
    await ready();
    await pick('Inspection form', 'No form');
    expect(screen.queryByRole('textbox', { name: 'Place (optional)' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ inspectionFormId: null, inspectionPlace: null });
  });
});

describe('New task form: two columns from 1024px (1.22)', () => {
  it('what the task is on the left; when, who and how on the right', async () => {
    windowWidth(1280);
    renderDialog();
    await ready();
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    const left = dialog.querySelector<HTMLElement>('[data-form-column="task"]')!;
    const right = dialog.querySelector<HTMLElement>('[data-form-column="details"]')!;
    expect(left.parentElement!.className).toMatch(/grid-cols-/);
    expect(left).toContainElement(screen.getByRole('button', { name: /^project$/i }));
    expect(left).toContainElement(screen.getByLabelText(/^task title/i));
    expect(left).toContainElement(screen.getByLabelText(/^description/i));
    expect(right).toContainElement(screen.getByRole('button', { name: 'Priority' }));
    expect(right).toContainElement(screen.getByLabelText(/^due date/i));
    expect(right).toContainElement(screen.getByRole('button', { name: 'Repeat' }));
    expect(right).toContainElement(screen.getByText('Needs approval'));
    // The narrower column gives Repeat a line of its own.
    expect(screen.getByRole('button', { name: 'Repeat' }).closest('.min-w-0')!.className).toMatch(/col-span-2/);
  });

  it('below 1024px: one column in the order it always had', async () => {
    windowWidth(900);
    renderDialog();
    await ready();
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    expect(dialog.querySelector('[data-form-column]')).toBeNull();
    expect(screen.getByLabelText(/^description/i).compareDocumentPosition(screen.getByRole('button', { name: 'Priority' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('1.23.5 the task’s weight (projects counting completion by weight)', () => {
  const weighed = () => (override = (u) => (u.endsWith('/projects') ? json({ data: PROJECTS.map((p) => (p.id === 'p1' ? { ...p, completionMode: 'WEIGHT', weightNormal: 2, weightHigh: 5 } : p)) }) : undefined));

  it('a new task in such a project: the Weight field, its default named by the priority; the points chosen are sent', async () => {
    weighed();
    renderDialog({ projectId: 'p1' });
    await ready();
    expect(screen.getByRole('button', { name: 'Weight' })).toHaveTextContent('Default (2)');
    await pick('Priority', 'High');
    expect(screen.getByRole('button', { name: 'Weight' })).toHaveTextContent('Default (5)');
    await pick('Weight', '8 points');
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Pour slab');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ title: 'Pour slab', priority: 'HIGH', weight: 8 });
  });

  it('left on the default: no weight is sent (the project’s default for its priority counts)', async () => {
    weighed();
    renderDialog({ projectId: 'p1' });
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'Plain');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).not.toHaveProperty('weight');
  });

  it('a project counting by number shows no Weight field', async () => {
    renderDialog({ projectId: 'p1' });
    await ready();
    expect(screen.queryByRole('button', { name: 'Weight' })).toBeNull();
  });

  it('editing: a changed weight is saved, back to the default as none', async () => {
    weighed();
    renderDialog({ task: { ...TASK, weight: 3 } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Weight' })).toHaveTextContent('3 points'));
    await pick('Weight', 'Default (2)');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeTruthy());
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ weight: null, expectedVersion: 7 });
  });
});

// Notification & Scheduling centre: a due date on a day off is said (never moved); a task's own reminder schedule.
describe('Task form — days off and reminders', () => {
  const workingTime = { companyId: 'c1', timeZone: 'Asia/Muscat', weekStart: 0, workingDays: [0, 1, 2, 3, 4], hours: { start: '08:00', end: '17:00' }, from: '2026-01-01', to: '2027-12-31', daysOff: [{ day: '2026-11-20', name: 'National Day' }] };
  const schedules = [
    { id: 's1', name: 'Standard', isDefault: true, steps: { before: [2], onDue: true, after: [1], repeatEvery: 2 } },
    { id: 's2', name: 'Critical', isDefault: false, steps: { before: [5, 2, 1], onDue: true, after: [], repeatEvery: 1 } },
  ];

  it('warns when the due date is a holiday or a weekend of the project’s company, and keeps the date', async () => {
    override = (url) => (url.includes('/working-time') ? json({ data: workingTime }) : undefined);
    renderDialog({ projectId: 'p1' });
    await ready();
    const due = screen.getByLabelText(/^due date/i);
    fireEvent.change(due, { target: { value: '2026-11-20' } });
    expect(await screen.findByText('Fri 20 Nov is National Day — a day off.')).toBeInTheDocument();
    expect(due).toHaveValue('2026-11-20');
    expect(due.getAttribute('aria-describedby')).toContain(screen.getByText('Fri 20 Nov is National Day — a day off.').id);
    fireEvent.change(due, { target: { value: '2026-11-14' } });
    expect(await screen.findByText('Sat 14 Nov is a weekend day.')).toBeInTheDocument();
    fireEvent.change(due, { target: { value: '2026-11-15' } });
    await waitFor(() => expect(screen.queryByText(/a day off|a weekend day/)).toBeNull());
    expect(calls.some((c) => c.url.includes('/working-time?') && c.url.includes('projectId=p1'))).toBe(true);
  });

  it('an edit can give the task its own reminder schedule (saved after the task)', async () => {
    override = (url, method) => {
      if (url.endsWith('/tasks/t1/reminder-schedule') && method === 'GET') return json({ data: { scheduleId: null, projectScheduleId: null, inUseId: 's1', schedules, canEdit: true } });
      if (url.endsWith('/tasks/t1/reminder-schedule') && method === 'PUT') return json({ data: { scheduleId: 's2', projectScheduleId: null, inUseId: 's2', schedules, canEdit: true } });
      return undefined;
    };
    const { onSaved } = renderDialog({ task: TASK });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    expect(await screen.findByRole('button', { name: 'Reminders' })).toHaveTextContent('The project’s (Standard)');
    await pick('Reminders', 'Critical');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT' && c.url.endsWith('/tasks/t1/reminder-schedule'))!.body).toEqual({ scheduleId: 's2' });
  });

  it('no reminders choice for someone who can’t change it', async () => {
    override = (url) => (url.endsWith('/tasks/t1/reminder-schedule') ? json({ data: { scheduleId: null, projectScheduleId: null, inUseId: 's1', schedules, canEdit: false } }) : undefined);
    renderDialog({ task: TASK });
    await screen.findByRole('button', { name: 'Remove Omar A' });
    expect(screen.queryByRole('button', { name: 'Reminders' })).toBeNull();
  });
});

// Review fix #25 (13 Nov 2026): one Idempotency-Key for the form's life, kept across retries — a retry
// after a lost reply or a server error gets the task already made (the server answers it again), never a
// second one. It changes only after a definite refusal (a 4xx other than "still in progress": nothing was
// made, and the server would otherwise answer that refusal again).
describe('New task: the same request key across retries', () => {
  const keys = () => posts().map((c) => c.headers['Idempotency-Key']);
  async function tryCreate(title = 'Pour slab') {
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), title);
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
  }
  const again = async (n: number) => {
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(posts()).toHaveLength(n));
  };

  it('a server error, then Create again: the same key (the server answers the task it already made)', async () => {
    let n = 0;
    override = (u, method) => (u.endsWith('/tasks') && method === 'POST' && ++n === 1 ? json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500) : undefined);
    await tryCreate();
    expect(await screen.findByText(/Couldn’t create the task/)).toBeInTheDocument();
    await again(2);
    expect(keys()[0]).toBeTruthy();
    expect(keys()[1]).toBe(keys()[0]);
  });

  it('…also when the draft was changed in between (an unclear failure: the first try may have made the task)', async () => {
    let n = 0;
    override = (u, method) => (u.endsWith('/tasks') && method === 'POST' && ++n === 1 ? json({ error: { code: 'DATABASE_BUSY', message: 'Busy.' } }, 503) : undefined);
    await tryCreate();
    await screen.findByText(/Couldn’t create the task/);
    await userEvent.type(screen.getByLabelText(/^task title/i), ' now');
    await again(2);
    expect(keys()[1]).toBe(keys()[0]);
  });

  it('“still in progress” (409): the same key', async () => {
    let n = 0;
    override = (u, method) =>
      u.endsWith('/tasks') && method === 'POST' && ++n === 1 ? json({ error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Still running.' } }, 409) : undefined;
    await tryCreate();
    await screen.findByText(/Couldn’t create the task/);
    await again(2);
    expect(keys()[1]).toBe(keys()[0]);
  });

  it('a definite refusal (400, 403, another 409): a new key, so the corrected try isn’t answered with the old refusal', async () => {
    let n = 0;
    const refusals = [
      json({ error: { code: 'VALIDATION', message: 'Give the task a title.' } }, 400),
      json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } }, 403),
      json({ error: { code: 'TASK_KEY_CONFLICT', message: 'Another task was created at the same moment. Please try again.' } }, 409),
    ];
    override = (u, method) => (u.endsWith('/tasks') && method === 'POST' ? refusals[n++] : undefined);
    await tryCreate();
    await screen.findByText(/Couldn’t create the task/);
    await again(2);
    await waitFor(() => expect(screen.getByText(/You do not have access/)).toBeInTheDocument());
    await again(3);
    await waitFor(() => expect(screen.getByText(/Another task was created/)).toBeInTheDocument());
    await again(4);
    expect(new Set(keys()).size).toBe(4);
  });

  it('offline with files (never queued): the next try keeps the key', async () => {
    let n = 0;
    override = (u, method) => {
      if (u.endsWith('/tasks') && method === 'POST' && ++n === 1) throw new TypeError('Failed to fetch');
      return undefined;
    };
    renderDialog();
    await ready();
    await userEvent.type(screen.getByLabelText(/^task title/i), 'With a file');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'plan.pdf', { type: 'application/pdf' })] } });
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText(/files can’t be attached offline/)).toBeInTheDocument();
    await again(2);
    expect(keys()[1]).toBe(keys()[0]);
  });
});
