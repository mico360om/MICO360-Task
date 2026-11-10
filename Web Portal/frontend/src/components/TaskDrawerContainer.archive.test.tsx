import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { useAuthStore } from '../stores/auth-store';
import { clearArchiveNotice, useArchiveNotice } from '../lib/task-archive';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }) }));

// Task archive (bulk lane): the task panel archives a task (administrators and the people who run its
// project), and shows an archived one read-only with Unarchive for the same people.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const TASK = { id: 't1', key: 'MICO-1', title: 'Prepare report', description: 'Do it', projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 40, completedAt: null, createdAt: '', updatedAt: '' };
let current: Record<string, unknown>;
let posted: string[];

function serve(project: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && /\/tasks\/t1\/(archive|unarchive)$/.test(u)) {
        posted.push(u.slice(u.lastIndexOf('/') + 1));
        current = u.endsWith('/archive') ? { ...current, archivedAt: '2026-11-03T05:00:00Z', archivedById: 'u2' } : { ...current, archivedAt: null, archivedById: null };
        return json({ data: current });
      }
      if (u.endsWith('/projects')) return json({ data: [project] });
      if (u.includes('/members')) return json({ data: [{ id: 'u1', username: 'ada', email: '', firstName: 'Ada', lastName: 'L', role: 'MEMBER' }] });
      if (u.includes('/users/directory')) return json({ data: [{ id: 'u2', username: 'ali', firstName: 'Ali', lastName: 'Hassan', avatarUrl: null }] });
      if (u.includes('/checklist')) return json({ data: { items: [{ id: 'i1', taskId: 't1', text: 'Verify quotation', done: false, position: 0 }], progress: 0 } });
      if (u.includes('/comments')) return json({ data: [{ id: 'c1', taskId: 't1', userId: 'u1', body: 'Started on this.', createdAt: '' }] });
      if (u.includes('/attachments')) return json({ data: [] });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
      if (u.endsWith('/projects/p1/columns')) return json({ data: [{ id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0 }] });
      if (u.includes('/activity')) return json({ data: [] });
      if (u.includes('/assignees')) return json({ data: [] });
      if (u.includes('/tasks?')) return json({ data: [TASK] });
      if (u.endsWith('/tasks/t1')) return json({ data: current });
      return json({ data: [] });
    }),
  );
}
function signIn(roles: string[]) {
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles }, accessToken: 'at', refreshToken: 'rt' });
}
function open(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TaskDrawerContainer taskId="t1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}
const LIVE_PROJECT = { id: 'p1', code: 'MICO', name: 'MICO Ops', status: 'ACTIVE', canManage: true };

beforeEach(() => {
  current = { ...TASK };
  posted = [];
  clearArchiveNotice();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TaskDrawerContainer: task archive', () => {
  it('whoever runs the project archives it from More actions: the panel closes and says “MICO-1 archived” with Undo', async () => {
    signIn([]);
    serve(LIVE_PROJECT);
    const onClose = open();
    await screen.findByText('Prepare report');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(posted).toEqual(['archive']));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useArchiveNotice.getState().notice).toEqual({ text: 'MICO-1 archived', taskId: 't1', key: 'MICO-1' });
  });

  it('a team member who doesn’t run the project is never offered Archive', async () => {
    signIn([]);
    serve({ ...LIVE_PROJECT, canManage: false });
    open();
    await screen.findByText('Prepare report');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
  });

  it('an archived task is read-only: no Edit, no comment box, no checklist ticks; the banner names who archived it', async () => {
    signIn([]);
    current = { ...TASK, archivedAt: '2026-11-03T05:00:00Z', archivedById: 'u2' };
    serve({ ...LIVE_PROJECT, canManage: false });
    open();
    const banner = await screen.findByTestId('archived-banner');
    await waitFor(() => expect(banner).toHaveTextContent('by Ali Hassan — read-only'));
    expect(within(banner).queryByRole('button', { name: 'Unarchive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit task' })).toBeNull();
    expect(screen.getByText('Started on this.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /comment/i })).toBeNull();
    expect(screen.getByText('Verify quotation')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Verify quotation/ })).toBeNull();
  });

  it('Unarchive (whoever runs the project) brings it back: the panel is editable again', async () => {
    signIn(['ADMIN']);
    current = { ...TASK, archivedAt: '2026-11-03T05:00:00Z', archivedById: 'u2' };
    serve(LIVE_PROJECT);
    open();
    const banner = await screen.findByTestId('archived-banner');
    await userEvent.click(within(banner).getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(posted).toEqual(['unarchive']));
    await waitFor(() => expect(screen.queryByTestId('archived-banner')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Edit task' })).toBeInTheDocument();
  });

  it('in an archived project neither Archive nor Unarchive is offered (reopen it first)', async () => {
    signIn(['ADMIN']);
    current = { ...TASK, archivedAt: '2026-11-03T05:00:00Z', archivedById: 'u2' };
    serve({ ...LIVE_PROJECT, status: 'ARCHIVED' });
    open();
    const banner = await screen.findByTestId('archived-banner');
    await waitFor(() => expect(screen.getByText('MICO Ops')).toBeInTheDocument());
    expect(within(banner).queryByRole('button', { name: 'Unarchive' })).toBeNull();
  });
});
