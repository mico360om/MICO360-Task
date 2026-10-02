import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
      if (u.includes('/checklist')) return json({ data: { items: [{ id: 'i1', taskId: 't1', text: 'Verify quotation', done: true, position: 0 }], progress: 100 } });
      if (u.includes('/comments')) return json({ data: [{ id: 'c1', taskId: 't1', userId: 'u1', body: 'Started on this.', createdAt: '' }] });
      if (u.includes('/attachments')) return json({ data: [{ id: 'a1', taskId: 't1', uploadedById: 'u1', filename: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 2048, url: '/uploads/a1.pdf', createdAt: '' }] });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: ['t2'], blocks: [] } });
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
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    const titleInput = screen.getByLabelText(/^title$/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Reworked report');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
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
    const picker = await screen.findByRole('combobox', { name: /assign a teammate/i });
    expect(picker).toHaveTextContent('Omar A');
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
    await screen.findByRole('combobox', { name: /assign a teammate/i }); // members loaded
    expect(screen.queryByRole('button', { name: /delete task/i })).not.toBeInTheDocument();
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

  it('shows the reason when an action fails (e.g. an oversized upload)', async () => {
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'POST' && String(url).includes('/attachments') ? json({ error: { code: 'TOO_LARGE', message: 'File too large' } }, 413) : base(url, init)));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TaskDrawerContainer taskId="t1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
    const input = screen.getByLabelText(/attach a file/i);
    await userEvent.upload(input, new File(['x'], 'huge.bin'));
    expect(await screen.findByText('That file is too large to upload.')).toBeInTheDocument();
  });
});
