import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { useAuthStore } from '../stores/auth-store';

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
      fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]).endsWith('/tasks/t1/checklist'));
    expect(added()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 steps' }));
    await waitFor(() => expect(added()).toHaveLength(2));
    expect(added().map((c) => JSON.parse(String((c[1] as RequestInit).body)).text)).toEqual(['Collect figures', 'Draft report']);
  });

  it('saves a new checklist order through the reorder endpoint', async () => {
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      String(url).endsWith('/tasks/t1/checklist') && (init?.method ?? 'GET') === 'GET'
        ? json({ data: { items: [{ id: 'i1', taskId: 't1', text: 'First', done: false, position: 0 }, { id: 'i2', taskId: 't1', text: 'Second', done: false, position: 1 }], progress: 0 } })
        : base(url, init),
    );
    vi.stubGlobal('fetch', fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    (await screen.findByRole('button', { name: 'Reorder “First”' })).focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/tasks/t1/checklist/reorder'));
      expect(put && JSON.parse(String((put[1] as RequestInit).body))).toEqual({ orderedIds: ['i2', 'i1'] });
    });
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
