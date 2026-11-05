import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const MAIN = {
  id: 't12', key: 'MICO-12', title: 'Service the pump', description: 'Main notes', projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 0,
  completedAt: null, createdAt: '', updatedAt: '', formerKeys: ['RIG-4', 'MICO-14'], mergedFrom: [{ id: 't14', key: 'MICO-14', mergeId: 'm1' }],
};
const PANEL = {
  merges: [{ mergeId: 'm1', mergedAt: '2026-11-05T09:00:00Z', mergedByName: 'Khurram Admin', canUndo: true, tasks: [{ id: 't14', key: 'MICO-14', title: 'Pump check', projectId: 'p1', projectName: 'Rig Inspection', createdByName: 'Omar', createdAt: '2026-11-03T09:00:00Z' }] }],
  labels: { comments: { c2: 'MICO-14' }, checklist: { i2: 'MICO-14' }, activity: {}, files: {} },
};
let calls: { method: string; url: string }[] = [];
let manages = true;

beforeEach(() => {
  calls = [];
  manages = true;
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ method: init?.method ?? 'GET', url: u });
      if (u.endsWith('/tasks/move-targets')) return json({ data: { managesAll: false, managedProjectIds: manages ? ['p1'] : [], projects: [] } });
      if (u.endsWith('/tasks/t12/merges')) return json({ data: PANEL });
      if (u.endsWith('/task-merges/m1/undo-preview')) return json({ data: { mergeId: 'm1', mainTaskId: 't12', mainKey: 'MICO-12', tasks: [{ id: 't14', key: 'MICO-14', title: 'Pump check' }], canUndo: true, reason: null, deletedSince: ['1 file from MICO-14 was deleted after the merge.'], mainMoved: null } });
      if (u.endsWith('/task-merges/m1/undo')) return json({ data: { mergeId: 'm1', mainTaskId: 't12', mainKey: 'MICO-12', restored: [{ id: 't14', key: 'MICO-14', projectId: 'p1' }], text: 'Undid the merge: MICO-14 is a separate task again' } });
      if (u.includes('/checklist')) return json({ data: { items: [{ id: 'i1', taskId: 't12', text: 'Own step', done: false, position: 0 }, { id: 'i2', taskId: 't12', text: 'Their step', done: false, position: 1 }], progress: 0 } });
      if (u.includes('/comments')) return json({ data: [{ id: 'c1', taskId: 't12', userId: 'u1', body: 'Own comment', createdAt: '' }, { id: 'c2', taskId: 't12', userId: 'u1', body: 'Their comment', createdAt: '' }] });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
      if (u.includes('/members') || u.includes('/attachments') || u.includes('/assignees') || u.includes('/activity') || u.includes('/watchers') || u.includes('/columns') || u.includes('/tasks?') || u.includes('/users') || u.includes('/projects')) return json({ data: [] });
      if (u.endsWith('/watch')) return json({ data: { watching: false } });
      // An old link: the merged task's id answers with the main task, saying which was asked for.
      if (u.endsWith('/tasks/t14')) return json({ data: { ...MAIN, mergeNotice: { key: 'MICO-14', mergedAt: '2026-11-05T09:00:00Z', mergedByName: 'Khurram Admin' } } });
      if (u.endsWith('/tasks/t12')) return json({ data: MAIN });
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function open(taskId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TaskDrawerContainer taskId={taskId} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('The task panel and merged tasks', () => {
  it('a merged task’s old link opens the main task, saying which task it was, and every read is the main task’s', async () => {
    open('t14');
    expect(await screen.findByText('MICO-14 was merged into this task on 5 Nov by Khurram Admin.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Task MICO-12' })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/tasks/t12/comments'))).toBe(true));
  });

  it('shows "Merged from" (the merged task’s number moves there from "Formerly") and labels what came from it', async () => {
    open('t12');
    const panel = await screen.findByRole('region', { name: 'Merged from' });
    expect(within(panel).getByText('Pump check')).toBeInTheDocument();
    expect(within(panel).getByText(/Merged 5 Nov by Khurram Admin/)).toBeInTheDocument();
    expect(screen.getByText('Formerly RIG-4')).toBeInTheDocument();
    expect(await screen.findByTestId('checklist-from')).toHaveTextContent('From MICO-14');
    expect(screen.getByText('Their comment').closest('li')).toHaveTextContent('from MICO-14');
  });

  it('Undo asks first, says what was deleted since, then undoes the whole merge', async () => {
    open('t12');
    const panel = await screen.findByRole('region', { name: 'Merged from' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Undo this merge…' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Undo this merge?' });
    expect(await within(ask).findByText('1 file from MICO-14 was deleted after the merge.')).toBeInTheDocument();
    await userEvent.click(within(ask).getByRole('button', { name: 'Undo merge' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/task-merges/m1/undo'))).toBe(true));
    expect(await screen.findByText('Undid the merge: MICO-14 is a separate task again')).toBeInTheDocument();
  });

  it('“Merge with other tasks…” is for whoever manages the project; employees don’t see it', async () => {
    open('t12');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: /Merge with other tasks/ })).toBeInTheDocument();
  });

  it('…and an employee sees no Merge item', async () => {
    manages = false;
    open('t12');
    await screen.findByRole('dialog', { name: 'Task MICO-12' });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/tasks/move-targets'))).toBe(true));
    const more = screen.queryByRole('button', { name: 'More actions' });
    if (more) {
      await userEvent.click(more);
      expect(screen.queryByRole('menuitem', { name: /Merge with other tasks/ })).not.toBeInTheDocument();
    }
  });
});
