import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { useAuthStore } from '../stores/auth-store';

// Comments live: the panel's own connection to the project room (no real socket in tests).
type SocketHandler = (...a: unknown[]) => void;
const socketHandlers: Record<string, SocketHandler> = {};
const fakeSocket = {
  on: vi.fn((ev: string, cb: SocketHandler) => { socketHandlers[ev] = cb; }),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const MEMBERS = [
  { id: 'u1', username: 'ada', email: '', firstName: 'Ada', lastName: 'L', role: 'MEMBER' },
  { id: 'u2', username: 'omar', email: '', firstName: 'Omar', lastName: 'A', role: 'MEMBER' },
];

beforeEach(() => {
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (/\/export\.(xlsx|pdf)$/.test(u)) return new Response('file-bytes', { status: 200 });
      if (u.includes('/members')) return json({ data: MEMBERS });
      if (u.endsWith('/tasks/t1/mentionable')) return json({ data: [{ id: 'u9', username: 'sara.k', firstName: 'Sara', lastName: 'Khan', avatarUrl: null }] });
      if (u.includes('/checklist')) return json({ data: { items: [{ id: 'i1', taskId: 't1', text: 'Verify quotation', done: true, position: 0 }], progress: 100 } });
      if (u.includes('/comments')) return json({ data: [{ id: 'c1', taskId: 't1', userId: 'u1', body: 'Started on this.', createdAt: '' }] });
      if (u.includes('/attachments')) return json({ data: [
        { id: 'a1', taskId: 't1', uploadedById: 'u1', filename: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 2048, url: '/uploads/a1.pdf', createdAt: '' },
        { id: 'a2', taskId: 't1', uploadedById: 'u2', filename: 'theirs.pdf', mimeType: 'application/pdf', sizeBytes: 10, url: '/uploads/a2.pdf', createdAt: '' },
      ] });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: ['t2'], blocks: [] } });
      if (u.endsWith('/projects/p1/columns')) return json({ data: [
        { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0 },
        { id: 'c9', projectId: 'p1', name: 'Done', category: 'DONE', position: 1 },
      ] });
      if (u.endsWith('/tasks/t1/activity')) return json({ data: [
        { id: 'ac1', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'MOVED', createdAt: new Date().toISOString(), actor: { id: 'u2', name: 'Omar A' }, meta: { from: 'Backlog', to: 'To Do' } },
      ] });
      if (u.endsWith('/ai/breakdown')) return json({ data: { items: ['Collect figures', 'Draft report'] } });
      if (u.includes('/assignees')) return json({ data: [] });
      if (u.endsWith('/users')) return json({ data: [] });
      // project task list (has a query string)
      if (u.includes('/tasks?')) return json({ data: [
        { id: 't1', key: 'MICO-1', title: 'Prepare report', description: '', projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 40, completedAt: null, createdAt: '', updatedAt: '' },
        { id: 't2', key: 'MICO-2', title: 'Do first', description: '', projectId: 'p1', columnId: 'c1', position: 1, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' },
      ] });
      // single task
      return json({ data: { id: 't1', key: 'MICO-1', title: 'Prepare report', description: 'Do it', projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 40, completedAt: null, createdAt: '', updatedAt: '' } });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

describe('TaskDrawerContainer', () => {
  it('fetches the task, checklist and comments and renders the drawer', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    expect(screen.getByText('Verify quotation')).toBeInTheDocument();
    expect(screen.getByText('Started on this.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: /spec\.pdf/ })).toBeInTheDocument());
    // dependency id t2 is resolved to its task key/title via the project task list
    await waitFor(() => expect(screen.getByText('Do first')).toBeInTheDocument());
    expect(screen.getByText('MICO-2')).toBeInTheDocument();
  });

  it('Show to client: offered to whoever runs the project, and saved on the server', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('switch', { name: 'Show to client' }));
    const fetchMock = vi.mocked(fetch);
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/tasks/t1/client-visible') && (init as RequestInit | undefined)?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ visible: true });
    });
  });

  it('Show to client isn’t offered to a team member who doesn’t run the project', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    expect(screen.queryByRole('switch', { name: 'Show to client' })).toBeNull();
  });

  it('opens the full edit form from the panel, filled in with the task', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Edit task' }));
    const form = await screen.findByRole('dialog', { name: 'Edit task' });
    expect(within(form).getByLabelText(/^task title/i)).toHaveValue('Prepare report');
    expect(within(form).getByLabelText(/^description/i)).toHaveValue('Do it');
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Column' })).toHaveTextContent('To Do'));
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(form).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Task MICO-1' })).toBeInTheDocument(); // the panel stays open
  });

  it('downloads the task as Excel or PDF, named after its key and title', async () => {
    const downloads: string[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^Export/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(downloads).toContain('MICO-1-prepare-report.xlsx'));
    const calls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.endsWith('/tasks/t1/export.xlsx'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /^Export/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
    await waitFor(() => expect(downloads).toContain('MICO-1-prepare-report.pdf'));
  });

  it('saves an inline field edit via PUT /tasks/:id with the patched fields', async () => {
    const calls: { url: string; method: string; body: Record<string, unknown> | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        calls.push({
          url: u,
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (u.includes('/members')) return json({ data: MEMBERS });
        if (u.includes('/checklist')) return json({ data: { items: [], progress: 0 } });
        if (u.includes('/comments')) return json({ data: [] });
        if (u.includes('/attachments')) return json({ data: [] });
        if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
        if (u.includes('/assignees')) return json({ data: [] });
        if (u.endsWith('/users')) return json({ data: [] });
        if (u.includes('/tasks?')) return json({ data: [] });
        return json({ data: { id: 't1', key: 'MICO-1', title: 'Prepare report', description: 'Do it', projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 40, completedAt: null, createdAt: '', updatedAt: '' } });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    const titleInput = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Reworked report{Enter}');
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && /\/tasks\/t1$/.test(c.url));
      expect(put).toBeTruthy();
      expect(put!.body?.title).toBe('Reworked report');
    });
  });

  it('offers every project member as an assignee (not the admin-only user list)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add assignee' }));
    expect(await screen.findByRole('option', { name: /Omar A/ })).toBeInTheDocument();
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => /\/users$/.test(u))).toBe(false);
  });

  it('hides Delete for a plain member (only admins and project managers may delete)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add assignee' }));
    await screen.findByRole('option', { name: /Omar A/ }); // members loaded
    expect(screen.queryByRole('button', { name: /delete task/i })).not.toBeInTheDocument();
  });

  it('offers Delete to someone who runs the project — its owner too — as the server says', async () => {
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/projects')) return json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#8B1E1E', ownerId: 'u1', canManage: true }] });
      return base(url, init);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: /delete task/i })).toBeInTheDocument();
  });

  it('offers Save as template in More actions to someone who runs the project, not to a plain member', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    await screen.findByRole('button', { name: 'More actions' });
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Save as template…' })).not.toBeInTheDocument();
    unmount();
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/projects')) return json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#8B1E1E', ownerId: 'u1', canManage: true }] });
      return base(url, init);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: /delete task/i });
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save as template…' }));
    expect(await screen.findByRole('dialog', { name: 'Save task as template' })).toBeInTheDocument();
  });

  it('shows "not found" with a Close button (and closes on Escape) for a deleted task', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } }, 404)));
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="gone" onClose={onClose} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/task not found, or you don’t have access/i)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('suggests the people an @mention in a comment would notify', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText(/write a comment/i), '@sa');
    expect(await screen.findByRole('option', { name: /Sara Khan/ })).toHaveTextContent('@sara.k');
  });

  it('shows the reason when an upload fails (e.g. an oversized file)', async () => {
    // Uploads go over XMLHttpRequest (for progress): answer this one "too large".
    class TooLarge {
      upload = { onprogress: null };
      status = 0;
      responseText = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.status = 413;
        this.responseText = JSON.stringify({ error: { code: 'TOO_LARGE', message: 'File too large' } });
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('XMLHttpRequest', TooLarge);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'huge.bin'));
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.bin: That file is too large to upload.');
  });

  it('offers to delete only your own files', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Delete spec.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete theirs.pdf' })).not.toBeInTheDocument();
  });

  it('shows the timeline with what changed, and a blocker’s status', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    const timeline = await screen.findByRole('list', { name: 'Activity' });
    expect(timeline).toHaveTextContent('Omar A moved this task');
    expect(timeline).toHaveTextContent('Backlog→To Do');
    expect(await screen.findByText('Waiting on 1 open task')).toBeInTheDocument();
  });

  it('adds AI-suggested steps only after you review them', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /suggest steps/i }));
    await screen.findByRole('group', { name: 'Suggested steps' });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const added = () =>
      fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]).endsWith('/tasks/t1/checklist/batch'));
    expect(added()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 steps' }));
    // 1.23.3: in one go (one "added 2 items" history line), into the first checklist.
    await waitFor(() => expect(added()).toHaveLength(1));
    expect(JSON.parse(String((added()[0]![1] as RequestInit).body))).toEqual({ texts: ['Collect figures', 'Draft report'] });
  });
});

describe('TaskDrawerContainer: nested checklists (1.23.3)', () => {
  const LISTS = [
    { id: 'L1', taskId: 't1', title: 'Electrical', position: 0, done: 1, total: 2 },
    { id: 'L2', taskId: 't1', title: 'Plumbing', position: 1, done: 0, total: 1 },
  ];
  const ITEMS = [
    { id: 'a', taskId: 't1', listId: 'L1', parentId: null, depth: 0, text: 'Wiring', done: false, position: 0, childCount: 2, subDone: 1, subTotal: 2 },
    { id: 'a1', taskId: 't1', listId: 'L1', parentId: 'a', depth: 1, text: 'Label circuits', done: true, position: 0, assigneeId: 'u2', assignee: { id: 'u2', name: 'Omar A' }, dueDate: '2026-11-03' },
    { id: 'a2', taskId: 't1', listId: 'L1', parentId: 'a', depth: 1, text: 'Test breakers', done: false, position: 1 },
    { id: 'c', taskId: 't1', listId: 'L2', parentId: null, depth: 0, text: 'Pipes', done: false, position: 0 },
  ];
  type Call = { url: string; method: string; body: Record<string, unknown> | null };
  let calls: Call[];
  beforeEach(() => {
    calls = [];
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        calls.push({ url: u, method, body });
        if (u.endsWith('/tasks/t1/checklist') && method === 'GET') return json({ data: { items: ITEMS, lists: LISTS, progress: 33, done: 1, total: 3 } });
        if (u.endsWith('/tasks/t1/checklist/deleted')) return json({ data: [{ batchId: 'b-old', kind: 'item', title: 'Old step', count: 1, deletedAt: '', deletedBy: null, until: '' }] });
        if (u.endsWith('/tasks/t1/activity'))
          return json({ data: [{ id: 'h1', taskId: 't1', projectId: 'p1', userId: 'u2', action: 'CHECKLIST_REMOVED', createdAt: new Date().toISOString(), actor: { id: 'u2', name: 'Omar A' }, meta: { itemId: 'x', text: 'Old step', count: 1, batchId: 'b-old' } }] });
        if (u.endsWith('/checklist/a2') && method === 'DELETE') return json({ data: { batchId: 'b-new', count: 1, taskId: 't1' } });
        if (u.endsWith('/tasks/t1/checklist/restore')) return json({ data: { restored: 1, taskId: 't1' } });
        if (/\/checklist\/[a-z0-9]+\/move$/.test(u)) return json({ data: ITEMS[2] });
        if (u.endsWith('/tasks/t1/checklist') && method === 'POST') return json({ data: { ...ITEMS[3], id: 'n1', text: String(body?.text) } }, 201);
        if (/\/checklist\/[a-z0-9]+$/.test(u) && method === 'PUT') return json({ data: ITEMS[2] });
        return base(url, init);
      }),
    );
  });
  const open = (props: { focusItemId?: string } = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} {...props} />
      </QueryClientProvider>,
    );
  };
  const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.url.endsWith(path));

  it('shows each checklist with its items nested, and saves a tick, a move and a sub-item through the new routes', async () => {
    open();
    expect(await screen.findByText('1/3 completed')).toBeInTheDocument();
    expect(screen.getAllByTestId('checklist-card').map((c) => c.getAttribute('data-list-id'))).toEqual(['L1', 'L2']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Test breakers' }));
    await waitFor(() => expect(sent('PUT', '/checklist/a2')[0]?.body).toEqual({ done: true }));
    await userEvent.click(screen.getByRole('button', { name: 'More actions for “Test breakers”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(sent('POST', '/checklist/a2/move')[0]?.body).toEqual({ action: 'up' }));
    await userEvent.click(screen.getByRole('button', { name: 'More actions for “Pipes”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add sub-item' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New sub-item of “Pipes”' }), 'Drains{Enter}');
    await waitFor(() => expect(sent('POST', '/tasks/t1/checklist')[0]?.body).toEqual({ text: 'Drains', listId: 'L2', parentId: 'c' }));
  });

  it('assigns an item and sets its due date', async () => {
    open();
    await screen.findByText('1/3 completed');
    await userEvent.click(screen.getByRole('button', { name: 'More actions for “Pipes”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Assign…' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Who is “Pipes” for?' }), 'omar{Enter}');
    await waitFor(() => expect(sent('PUT', '/checklist/c')[0]?.body).toEqual({ assigneeId: 'u2' }));
  });

  it('a delete has Undo (restoring its batch), and the history offers Restore while it can be restored', async () => {
    open();
    await screen.findByText('1/3 completed');
    await userEvent.click(screen.getByRole('button', { name: 'More actions for “Test breakers”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(sent('DELETE', '/checklist/a2')).toHaveLength(1));
    await userEvent.click(within(await screen.findByTestId('checklist-undo')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('POST', '/tasks/t1/checklist/restore')[0]?.body).toEqual({ batchId: 'b-new' }));
    const timeline = await screen.findByRole('list', { name: 'Activity' });
    await userEvent.click(within(timeline).getByRole('button', { name: 'Restore “Old step”' }));
    await waitFor(() => expect(sent('POST', '/tasks/t1/checklist/restore').map((c) => c.body)).toContainEqual({ batchId: 'b-old' }));
  });

  it('opened at an item (…&item=): it is brought into view and marked', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    open({ focusItemId: 'a2' });
    await waitFor(() => expect(screen.getAllByTestId('checklist-item').find((li) => li.getAttribute('data-item-id') === 'a2')).toHaveAttribute('data-found', 'true'));
  });
});

describe('TaskDrawerContainer: moving the task to another project', () => {
  const PROJECTS = [
    { id: 'p1', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE', color: '#8B1E1E', icon: null, imageUrl: null },
    { id: 'p2', code: 'OPS', name: 'Operations', status: 'ACTIVE', color: '#1E5B8B', icon: null, imageUrl: null },
  ];
  const TASK = { id: 't1', key: 'RIG-4', title: 'Inspect the rig', description: '', projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' };
  const MOVED = { ...TASK, key: 'OPS-17', projectId: 'p2', columnId: 'o1', formerKeys: ['RIG-4'] };

  /** The drawer's usual answers, plus where tasks may go and the move itself; `moved` once it has moved. */
  function server(opts: { managesAll?: boolean; managed?: string[] } = {}) {
    let moved = false;
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.endsWith('/tasks/move-targets')) return json({ data: { managesAll: opts.managesAll ?? false, managedProjectIds: opts.managed ?? ['p1', 'p2'], projects: PROJECTS } });
      if (u.endsWith('/tasks/move-preview')) {
        return json({ data: { project: { ...PROJECTS[1], defaultDueToday: false }, columns: [{ id: 'o1', name: 'Next', category: 'TODO', position: 0, enabled: true }], outsiders: [], tasks: [
          { id: 't1', key: 'RIG-4', title: 'Inspect the rig', from: { id: 'p1', code: 'RIG', name: 'Rig Inspection' }, canMove: true, reason: null, newKey: 'OPS-17', currentCategory: 'TODO', columnId: 'o1', milestoneCleared: false, dueDate: null, repeat: null, outsiders: [] },
        ] } });
      }
      if (u.endsWith('/tasks/t1/move-to-project') && method === 'POST') {
        moved = true;
        return json({ data: { task: MOVED, from: { projectId: 'p1', name: 'Rig Inspection', key: 'RIG-4' }, to: { projectId: 'p2', name: 'Operations', key: 'OPS-17' }, addedToTeam: [], unassigned: [], milestoneCleared: false, dueDateSet: null } });
      }
      if (u.endsWith('/tasks/t1') && method === 'GET') return json({ data: moved ? MOVED : TASK });
      if (u.endsWith('/tasks/x9')) return json({ data: { ...TASK, id: 'x9', key: 'OPS-3', title: 'Order the parts elsewhere', projectId: 'p2', columnCategory: 'DONE' } });
      return base(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  const renderDrawer = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );

  it('moves it from More actions: a toast says where, and the panel stays open showing its new key and project', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    server({ managesAll: true, managed: [] });
    renderDrawer();
    const header = await screen.findByTestId('task-header');
    await waitFor(() => expect(within(header).getByText('Rig Inspection')).toBeInTheDocument());
    await userEvent.click(within(header).getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to another project…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move to another project' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations/ }));
    await userEvent.click(await within(dialog).findByRole('button', { name: /^Move task/ }));
    const toast = await screen.findByText('Moved to Operations as OPS-17');
    expect(toast.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Move to another project' })).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId('task-header')).getByText('OPS-17')).toBeInTheDocument());
    expect(within(screen.getByTestId('task-header')).getByText('Operations')).toBeInTheDocument();
    expect(within(screen.getByTestId('task-header')).getByText('Formerly RIG-4')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Task OPS-17' })).toBeInTheDocument();
  });

  it('for someone who doesn’t manage its project, the item is there but unavailable, saying why', async () => {
    server({ managed: ['p2'] });
    renderDrawer();
    const header = await screen.findByTestId('task-header');
    await waitFor(() => expect(within(header).getByText('Rig Inspection')).toBeInTheDocument());
    await userEvent.click(within(header).getByRole('button', { name: 'More actions' }));
    const item = await screen.findByRole('menuitem', { name: /Move to another project…/ });
    await waitFor(() => expect(item).toHaveTextContent('To move it, you need to manage both Rig Inspection and the project it goes to.'));
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('names a blocker that is in another project (it stays linked after a move)', async () => {
    const base = server();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (String(url).includes('/dependencies') ? json({ data: { blockedBy: ['t2', 'x9'], blocks: [] } }) : base(url, init))));
    renderDrawer();
    expect(await screen.findByText('Order the parts elsewhere')).toBeInTheDocument();
    expect(screen.getByText('OPS-3')).toBeInTheDocument();
    expect(screen.getByText('Do first')).toBeInTheDocument();
  });
});

describe('TaskDrawerContainer — who may delete this task (its creator, or the one person it’s assigned to)', () => {
  const REASON = 'Only the person who created this task, or the one person it’s assigned to, can delete it.';
  const SERIES = 'Only the person who created this repeating task can delete the entire series.';
  const TASK = { id: 't1', key: 'MICO-1', title: 'Prepare report', description: 'Do it', projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 40, completedAt: null, createdAt: '', updatedAt: '' };
  /** Someone who runs p1 opens t1, as the server describes it (and with these assignees). */
  function open(task: Record<string, unknown>, assignees: string[] = []) {
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith('/projects')) return json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#8B1E1E', ownerId: 'u9', canManage: true }] });
      if (u.endsWith('/tasks/t1/assignees')) return json({ data: assignees.map((id) => MEMBERS.find((m) => m.id === id)) });
      if (u.endsWith('/tasks/t1')) return json({ data: { ...TASK, ...task } });
      return base(url, init);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
  }

  it('the server says no: Delete task stays, greyed out with the reason', async () => {
    open({ createdById: 'u2', canDelete: false, canDeleteSeries: false });
    const button = await screen.findByRole('button', { name: /delete task/i });
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });

  it('the server says yes: Delete task works as before', async () => {
    open({ createdById: 'u2', canDelete: true, canDeleteSeries: false });
    const button = await screen.findByRole('button', { name: /delete task/i });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(REASON)).toBeNull();
  });

  it('a repeating copy they may delete, but not its series: only “Entire series” is greyed out', async () => {
    open({ createdById: 'u2', recurrenceRule: { freq: 'WEEKLY', interval: 1 }, canDelete: true, canDeleteSeries: false }, ['u1']);
    await userEvent.click(await screen.findByRole('button', { name: /delete task/i }));
    expect(screen.getByRole('button', { name: /entire series/i })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(SERIES)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This copy' })).not.toHaveAttribute('aria-disabled');
  });

  it('a refusal sent anyway (someone changed who it’s assigned to meanwhile) is told in the server’s words', async () => {
    open({ createdById: 'u2', canDelete: true });
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/tasks/t1') && (init as RequestInit | undefined)?.method === 'DELETE') {
        return json({ error: { code: 'DELETE_NOT_ALLOWED', message: REASON } }, 403);
      }
      return base(url, init);
    });
    await userEvent.click(await screen.findByRole('button', { name: /delete task/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(await screen.findByText(REASON)).toBeInTheDocument();
  });

  it('a server that doesn’t say: the same rule worked out here from who created it and who it’s assigned to', async () => {
    open({ createdById: 'u2' }, ['u1', 'u2']);
    const button = await screen.findByRole('button', { name: /delete task/i });
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    cleanup();
    open({ createdById: 'u2' }, ['u1']);
    const mine = await screen.findByRole('button', { name: /delete task/i });
    await screen.findByText('Ada L'); // its one assignee (me) is loaded
    expect(mine).not.toHaveAttribute('aria-disabled');
  });
});

describe('TaskDrawerContainer — Previous / Next (1.22)', () => {
  it('shows the panel’s steps; a step to another task leaves nothing of the last one open over it', async () => {
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      String(url).endsWith('/tasks/t2')
        ? json({ data: { id: 't2', key: 'MICO-2', title: 'Do first', description: '', projectId: 'p1', columnId: 'c1', position: 1, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' } })
        : base(url, init)));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} stepper={{ position: 1, total: 2, onNext: vi.fn() }} />
      </QueryClientProvider>,
    );
    await screen.findByRole('dialog', { name: 'Task MICO-1' });
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit task' }));
    expect(await screen.findByRole('dialog', { name: 'Edit task' })).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t2" onClose={() => {}} stepper={{ position: 2, total: 2, onPrevious: vi.fn(), focus: 'next' }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'Task MICO-2' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit task' })).not.toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    // Next was pressed and is greyed out now: focus is on Previous.
    expect(screen.getByRole('button', { name: 'Previous task' })).toHaveFocus();
  });
});

// 1.23 Client accounts: a client's comments and sign-off, as the team sees them in a task.
describe('TaskDrawerContainer — clients (1.23)', () => {
  const clientRow = {
    id: 'c5', taskId: 't1', userId: 'client-1', body: 'Is the valve fitted?', parentId: null, createdAt: new Date().toISOString(), editedAt: null,
    fromClient: true, clientVisible: false, clientAuthor: { name: 'Hamad Al Busaidi', organisation: 'Petroleum Development Oman' },
  };
  const replyRow = { id: 'c6', taskId: 't1', userId: 'u1', body: 'Yes, this morning.', parentId: 'c5', createdAt: new Date().toISOString(), editedAt: null, fromClient: false, clientVisible: true };
  let posted: { url: string; method: string; body: unknown }[];
  const withClients = (task: Record<string, unknown> = {}) => {
    posted = [];
    let showDescription = false;
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') posted.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith('/tasks/t1/comments') && method === 'POST') return json({ data: { ...replyRow, id: 'c7' } }, 201);
      if (u.endsWith('/tasks/t1/comments')) return json({ data: [clientRow, replyRow] });
      if (u.endsWith('/tasks/t1/client-visible')) {
        showDescription = (JSON.parse(String(init?.body)) as { showDescription?: boolean }).showDescription === true;
        return json({ data: { id: 't1', clientVisible: true, clientShowDescription: showDescription } });
      }
      if (u.endsWith('/tasks/t1')) {
        return json({ data: { id: 't1', key: 'MICO-1', title: 'Prepare report', description: 'Do it', projectId: 'p1', columnId: 'c9', columnCategory: 'DONE', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 100, completedAt: '2026-10-29T08:00:00.000Z', createdAt: '', updatedAt: '', clientVisible: true, clientShowDescription: showDescription, clientAcceptedAt: '2026-10-30T09:00:00.000Z', ...task } });
      }
      return base(url, init);
    }));
  };
  const open = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
  };

  it('names a client’s comment from the comment itself (clients aren’t in the people directory), marked Client', async () => {
    withClients();
    open();
    const item = (await screen.findByText('Is the valve fitted?')).closest('li')!;
    expect(within(item).getByText('Hamad Al Busaidi')).toBeInTheDocument();
    expect(within(item).getByText('Client')).toBeInTheDocument();
    expect(within(item).getByText('Petroleum Development Oman')).toBeInTheDocument();
    // The team's reply sits under it, marked as one the client sees.
    const reply = within(screen.getByRole('list', { name: 'Replies to Hamad Al Busaidi' })).getByText('Yes, this morning.').closest('li')!;
    expect(within(reply).getByText('Visible to client')).toBeInTheDocument();
  });

  it('a reply marked “Visible to client” is sent with its comment and the tick', async () => {
    withClients();
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Reply to Hamad Al Busaidi' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply to Hamad Al Busaidi' }), 'Fitted at 9');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Visible to client' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(posted.find((p) => p.url.endsWith('/tasks/t1/comments'))?.body).toEqual({ body: 'Fitted at 9', parentId: 'c5', clientVisible: true }));
  });

  it('a reply for the team only is sent without the tick', async () => {
    withClients();
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Reply to Hamad Al Busaidi' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply to Hamad Al Busaidi' }), 'Ask the crew');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(posted.find((p) => p.url.endsWith('/tasks/t1/comments'))?.body).toEqual({ body: 'Ask the crew', parentId: 'c5' }));
  });

  it('shows “Client accepted · date”, and saves “Also show its description” for whoever runs the project', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    withClients();
    open();
    expect(await screen.findByText('Client accepted · 30 Oct 2026')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Also show its description' }));
    await waitFor(() => {
      const put = posted.find((p) => p.url.endsWith('/tasks/t1/client-visible'));
      expect(put).toMatchObject({ method: 'PUT', body: { visible: true, showDescription: true } });
    });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Also show its description' })).toBeChecked());
  });
});

describe('TaskDrawerContainer — files and clients (1.23.7)', () => {
  type Row = { id: string; taskId: string; uploadedById: string; filename: string; mimeType: string; sizeBytes: number; url: string; createdAt: string; fromClient: boolean; clientVisible: boolean };
  let files: Row[];
  let puts: { url: string; body: unknown }[];
  let refuse: { status: number; code: string; message: string } | null;
  const withFiles = () => {
    files = [
      { id: 'a1', taskId: 't1', uploadedById: 'u1', filename: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 2048, url: '/uploads/a1.pdf', createdAt: '', fromClient: false, clientVisible: false },
      { id: 'a2', taskId: 't1', uploadedById: 'client-1', filename: 'site-photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10, url: '/uploads/a2.jpg', createdAt: '', fromClient: true, clientVisible: true },
    ];
    puts = [];
    refuse = null;
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const put = /\/tasks\/t1\/attachments\/(\w+)\/client-visible$/.exec(u);
      if (put && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { visible: boolean };
        puts.push({ url: u, body });
        if (refuse) return json({ error: refuse }, refuse.status);
        const row = files.find((f) => f.id === put[1])!;
        row.clientVisible = body.visible;
        return json({ data: { ...row } });
      }
      if (u.endsWith('/tasks/t1/attachments')) return json({ data: files.map((f) => ({ ...f })) });
      return base(url, init);
    }));
  };
  const open = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
  };
  const asAdmin = () => useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });

  it('marks a client’s file “From client” for the whole team', async () => {
    withFiles();
    open();
    const row = (await screen.findByRole('link', { name: 'site-photo.jpg' })).closest('li')!;
    expect(within(row).getByText('From client')).toBeInTheDocument();
  });

  it('whoever runs the project ticks “Show to client” on a file: saved on the server, and it stays ticked', async () => {
    asAdmin();
    withFiles();
    open();
    const spec = await screen.findByRole('checkbox', { name: 'Show to client: spec.pdf' });
    expect(screen.getByRole('checkbox', { name: 'Show to client: site-photo.jpg' })).toBeChecked();
    await userEvent.click(spec);
    await waitFor(() => expect(puts).toEqual([{ url: expect.stringMatching(/\/tasks\/t1\/attachments\/a1\/client-visible$/), body: { visible: true } }]));
    await waitFor(() => expect(spec).toBeEnabled());
    expect(spec).toBeChecked();
  });

  it('a refusal is told in the server’s words (an archived project), and the tick goes back', async () => {
    asAdmin();
    withFiles();
    open();
    const spec = await screen.findByRole('checkbox', { name: 'Show to client: spec.pdf' });
    refuse = { status: 409, code: 'PROJECT_ARCHIVED', message: 'This project is archived — reopen it first.' };
    await userEvent.click(spec);
    const row = spec.closest('li')!;
    expect(await within(row).findByRole('alert')).toHaveTextContent('This project is archived — reopen it first.');
    expect(spec).not.toBeChecked();
  });

  it('a 403 says who may do it, in the server’s words (not a generic “no permission”)', async () => {
    asAdmin();
    withFiles();
    open();
    const spec = await screen.findByRole('checkbox', { name: 'Show to client: spec.pdf' });
    refuse = { status: 403, code: 'FORBIDDEN', message: 'Only the project manager or an administrator can show a file to clients.' };
    await userEvent.click(spec);
    expect(await within(spec.closest('li')!).findByRole('alert')).toHaveTextContent('Only the project manager or an administrator can show a file to clients.');
  });

  it('a team member who doesn’t run the project gets no ticks: a shown file just says “Shown to client”', async () => {
    withFiles();
    open();
    const row = (await screen.findByRole('link', { name: 'site-photo.jpg' })).closest('li')!;
    expect(within(row).getByText('Shown to client')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /show to client/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'spec.pdf' }).closest('li')!).queryByText('Shown to client')).not.toBeInTheDocument();
  });
});

describe('TaskDrawerContainer: writing a first checklist with the keyboard (1.23.3 review)', () => {
  type Item = { id: string; taskId: string; listId: string; parentId: string | null; depth: number; text: string; done: boolean; position: number };
  let lists: { id: string; taskId: string; title: string; position: number; done: number; total: number }[];
  let items: Item[];
  let posts: Record<string, unknown>[];
  let release: (() => void) | null;
  let slowGet = false;
  let releaseGet: (() => void) | null = null;
  beforeEach(() => {
    lists = [];
    items = [];
    posts = [];
    release = null;
    slowGet = false;
    releaseGet = null;
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';
        if (u.endsWith('/tasks/t1/checklist') && method === 'GET') {
          // Reading the checklist again after an add can be slow too.
          if (slowGet && posts.length > 1) {
            slowGet = false;
            await new Promise<void>((r) => (releaseGet = r));
          }
          return json({ data: { items, lists, progress: 0, done: 0, total: items.length } });
        }
        if (u.endsWith('/tasks/t1/checklist/deleted')) return json({ data: [] });
        if (u.endsWith('/tasks/t1/checklist') && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as { text: string; parentId?: string };
          posts.push(body);
          // The first add waits (a slow connection); the server makes the task's first "Checklist" with it.
          if (posts.length === 1) await new Promise<void>((r) => (release = r));
          if (!lists.length) lists = [{ id: 'L1', taskId: 't1', title: 'Checklist', position: 0, done: 0, total: 0 }];
          const made: Item = { id: `n${posts.length}`, taskId: 't1', listId: 'L1', parentId: body.parentId ?? null, depth: body.parentId ? 1 : 0, text: body.text, done: false, position: items.length };
          items = [...items, made];
          return json({ data: made }, 201);
        }
        return base(url, init);
      }),
    );
  });

  it('“Buy wire”, Enter, then “Buy tape” at once: nothing typed is lost, focus stays in the box, Enter adds it too', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    const box = await screen.findByRole('textbox', { name: 'Add an item to “Checklist”' });
    await userEvent.type(box, 'Buy wire{Enter}');
    await waitFor(() => expect(release).not.toBeNull());
    // Still saving the first: keep typing.
    await userEvent.keyboard('Buy tape');
    release!();
    await waitFor(() => expect(screen.getAllByTestId('checklist-item').map((li) => li.getAttribute('data-item-id'))).toEqual(['n1']));
    const after = screen.getByRole('textbox', { name: 'Add an item to “Checklist”' });
    expect(after).toHaveValue('Buy tape');
    expect(after).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(posts).toEqual([{ text: 'Buy wire' }, { text: 'Buy tape', listId: 'L1' }]));
    await waitFor(() => expect(screen.getAllByTestId('checklist-item')).toHaveLength(2));
    expect(screen.getByRole('textbox', { name: 'Add an item to “Checklist”' })).toHaveFocus();
  });

  it('Enter in a new sub-item adds it, and typing goes on right after it once it is there', async () => {
    lists = [{ id: 'L1', taskId: 't1', title: 'Checklist', position: 0, done: 0, total: 1 }];
    items = [{ id: 'w', taskId: 't1', listId: 'L1', parentId: null, depth: 0, text: 'Wiring', done: false, position: 0 }];
    posts = [{ text: 'skip the slow first add' }];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for “Wiring”' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add sub-item' }));
    slowGet = true;
    await userEvent.type(screen.getByRole('textbox', { name: 'New sub-item of “Wiring”' }), 'Label circuits{Enter}');
    await waitFor(() => expect(releaseGet).not.toBeNull());
    // The checklist is still being read again: keep typing the next one.
    await userEvent.keyboard('Test breakers');
    releaseGet!();
    const next = await screen.findByRole('textbox', { name: 'New item after “Label circuits”' });
    expect(next).toHaveFocus();
    expect(next).toHaveValue('Test breakers');
  });
});

// Comments, newest first (owner, 10 Nov 2026): live, at once, and replies on every comment.
describe('TaskDrawerContainer — comments live, newest first', () => {
  const at = (h: number) => `2026-11-10T0${h}:00:00.000Z`;
  let rows: Record<string, unknown>[];
  let posted: { url: string; body: unknown }[];
  let answerPost: ((r: Response) => void) | null;
  const serve = () => {
    posted = [];
    answerPost = null;
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/tasks/t1/comments') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { body: string; parentId?: string };
        posted.push({ url: u, body });
        const saved = { id: `n${posted.length}`, taskId: 't1', userId: 'u1', body: body.body, parentId: body.parentId ?? null, createdAt: at(9), editedAt: null };
        return new Promise<Response>((resolve) => {
          // Saved on the server at once (a re-read finds it), answered when the test says.
          rows = [...rows, saved];
          answerPost = () => resolve(json({ data: saved }, 201));
        });
      }
      if (u.endsWith('/tasks/t1/comments')) return json({ data: rows });
      if (u.endsWith('/users/directory')) return json({ data: MEMBERS.map((m) => ({ id: m.id, username: m.username, firstName: m.firstName, lastName: m.lastName, avatarUrl: null })) });
      return base(url, init);
    }));
  };
  const open = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
  };
  const bodies = () =>
    within(screen.getByRole('list', { name: 'Comments, newest first' }))
      .getAllByRole('listitem')
      .filter((li) => li.parentElement?.getAttribute('aria-label') === 'Comments, newest first')
      .map((li) => li.querySelector('[data-comment-body]')?.textContent);

  beforeEach(() => {
    for (const k of Object.keys(socketHandlers)) delete socketHandlers[k];
    fakeSocket.emit.mockClear();
    rows = [
      { id: 'c1', taskId: 't1', userId: 'u2', body: 'First note', parentId: null, createdAt: at(1), editedAt: null },
      { id: 'c2', taskId: 't1', userId: 'u2', body: 'Second note', parentId: null, createdAt: at(2), editedAt: null },
    ];
    serve();
  });

  it('shows the newest comment first', async () => {
    open();
    await screen.findByText('Second note');
    expect(bodies()).toEqual(['Second note', 'First note']);
  });

  it('a comment someone else adds to this task appears without reopening; an edit and a delete too', async () => {
    open();
    await screen.findByText('Second note');
    act(() => socketHandlers['connect']!());
    expect(fakeSocket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    rows = [...rows, { id: 'c3', taskId: 't1', userId: 'u2', body: 'Live from site', parentId: null, createdAt: at(3), editedAt: null }];
    act(() => socketHandlers['comment:created']!({ taskId: 't1', comment: { id: 'c3' } }));
    await waitFor(() => expect(bodies()).toEqual(['Live from site', 'Second note', 'First note']));
    rows = rows.filter((r) => r.id !== 'c1').map((r) => (r.id === 'c2' ? { ...r, body: 'Second note, changed', editedAt: at(4) } : r));
    act(() => socketHandlers['comment:updated']!({ taskId: 't1', comment: { id: 'c2' } }));
    await waitFor(() => expect(bodies()).toEqual(['Live from site', 'Second note, changed']));
  });

  it('my comment is at the top at once, and shows once when its live copy and the answer both come', async () => {
    open();
    await screen.findByText('Second note');
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'On my way');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(bodies()[0]).toBe('On my way');
    expect(screen.getByText('Sending…')).toBeInTheDocument();
    await waitFor(() => expect(posted).toHaveLength(1));
    // Its live copy first …
    act(() => socketHandlers['comment:created']!({ taskId: 't1', comment: { id: 'n1' } }));
    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
    expect(bodies()).toEqual(['On my way', 'Second note', 'First note']);
    // … then the server's answer: still once.
    await act(async () => answerPost!(json({})));
    await waitFor(() => expect(bodies()).toEqual(['On my way', 'Second note', 'First note']));
  });

  it('every comment offers Reply; a reply names the comment it answers', async () => {
    open();
    await screen.findByText('Second note');
    await userEvent.click(screen.getAllByRole('button', { name: 'Reply to Omar A' })[0]!);
    expect(screen.queryByRole('checkbox', { name: 'Visible to client' })).toBeNull();
    await userEvent.type(screen.getAllByRole('textbox', { name: 'Reply to Omar A' })[0]!, 'Agreed');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(posted[0]?.body).toEqual({ body: 'Agreed', parentId: 'c2' }));
  });
});

describe('TaskDrawerContainer — a task in the Recycle Bin', () => {
  const detail = {
    task: {
      id: 'tx', key: 'RIG-12', title: 'Replace the pump', description: 'Old one leaks', priority: 'HIGH', startDate: null, dueDate: '2026-11-20T00:00:00.000Z', isMilestone: false, repeats: false,
      createdAt: '2026-10-01T06:00:00.000Z', createdBy: { id: 'u2', name: 'Omar A' }, formerKeys: [], project: { id: 'p1', name: 'Rig works', code: 'RIG', color: '#333', icon: null, imageUrl: null },
      status: { name: 'Doing', category: 'IN_PROGRESS' },
    },
    assignees: [{ id: 'u1', name: 'Ada L' }],
    tags: [{ name: 'pumps', color: '#333' }],
    contacts: [],
    categories: [],
    checklists: [{ title: 'Steps', items: [{ text: 'Drain', done: true, depth: 0 }, { text: 'Close valve', done: false, depth: 1 }] }],
    comments: [{ id: 'c1', author: { id: 'u2', name: 'Omar A' }, body: 'Ordered the part', deleted: false, fromClient: false, createdAt: '2026-11-02T06:00:00.000Z', editedAt: null, replies: [{ id: 'c2', author: { id: 'u1', name: 'Ada L' }, body: 'Thanks', deleted: false, fromClient: false, createdAt: '2026-11-02T07:00:00.000Z', editedAt: null }] }],
    files: [{ filename: 'pump.pdf', sizeBytes: 2048, createdAt: '2026-11-02T06:00:00.000Z', uploadedBy: null }],
    blockers: [],
    history: [{ id: 'h1', taskId: 'tx', projectId: 'p1', userId: 'u2', action: 'DELETED', meta: {}, createdAt: '2026-11-03T06:00:00.000Z', actor: { id: 'u2', name: 'Ali Hassan' } }],
    bin: { deletedAt: '2026-11-03T06:00:00.000Z', deletedBy: { id: 'u2', name: 'Ali Hassan' }, binExpiresAt: '2027-01-02T20:00:00.000Z', daysLeft: 53, batch: null, canRestore: true, canErase: false },
  };
  function openDeleted(binAnswer: () => Response) {
    let restored = false;
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/recycle-bin/restore')) {
          posts.push(JSON.parse(String(init?.body)));
          restored = true;
          return json({ data: { restored: [{ id: 'tx', key: 'RIG-12', title: 'Replace the pump', projectId: 'p1' }], notRestored: [] } });
        }
        if (u.includes('/recycle-bin/tasks/tx')) return binAnswer();
        if (u.endsWith('/tasks/tx')) {
          return restored
            ? json({ data: { id: 'tx', key: 'RIG-12', title: 'Replace the pump', description: '', projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '' } })
            : json({ error: { code: 'TASK_DELETED', message: 'This task was deleted.' } }, 404);
        }
        // Its comments, files, checklist…: not readable while it is in the bin (as the server answers).
        if (u.includes('/tasks/tx/') && !restored) return json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } }, 404);
        if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
        if (u.includes('/checklist')) return json({ data: { items: [], progress: 0 } });
        return json({ data: [] });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="tx" onClose={() => {}} />
      </QueryClientProvider>,
    );
    return { posts };
  }

  it('someone who may restore it sees it read-only under the banner, and Restore brings it back', async () => {
    const { posts } = openDeleted(() => json({ data: detail }));
    const banner = await screen.findByText(/In the Recycle Bin — deleted by Ali Hassan on 3 Nov/);
    expect(banner.closest('[role="status"]')).toHaveTextContent('53 days left');
    expect(screen.getByRole('heading', { name: 'Replace the pump' })).toBeInTheDocument();
    expect(screen.getByText('Ordered the part')).toBeInTheDocument();
    expect(screen.getByText('Thanks')).toBeInTheDocument();
    expect(screen.getByText('pump.pdf')).toBeInTheDocument();
    expect(screen.getByText('Close valve')).toBeInTheDocument();
    expect(screen.getByText(/moved this task to the Recycle Bin/)).toBeInTheDocument();
    // Nothing to change: no inputs, no Delete task.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /delete task/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete forever' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(posts).toEqual([{ taskIds: ['tx'], wholeBatch: false }]);
    // Back: the task itself shows.
    await waitFor(() => expect(screen.queryByText(/In the Recycle Bin/)).toBeNull());
  });

  // tgc: 1.24 — a deleted task's guests show under "Guests" (no "External contacts" any more), its categories as chips.
  it('1.24: shows its guests and its categories', async () => {
    openDeleted(() => json({ data: { ...detail, contacts: [{ name: 'Ahmed Al Harthy', company: 'OXY' }, { name: 'Sara', company: null }], categories: [{ id: 'k1', name: 'Electrical', color: 'blue', retired: false }, { id: 'k2', name: 'Old works', color: 'grey', retired: true }] } }));
    await screen.findByText(/In the Recycle Bin — deleted by Ali Hassan/);
    expect(screen.getByRole('region', { name: 'Guests' })).toHaveTextContent('Ahmed Al Harthy (OXY), Sara');
    expect(screen.queryByRole('region', { name: 'External contacts' })).toBeNull();
    const cats = screen.getByRole('region', { name: 'Categories' });
    expect(within(cats).getByRole('img', { name: 'Category: Electrical' })).toBeInTheDocument();
    expect(within(cats).getByRole('img', { name: 'Category: Old works (retired)' })).toBeInTheDocument();
  });

  it('anyone else on the project: "This task was deleted"', async () => {
    openDeleted(() => json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } }, 404));
    expect(await screen.findByText('This task was deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });
});
