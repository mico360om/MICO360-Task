import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawerContainer } from './TaskDrawerContainer';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
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
});
