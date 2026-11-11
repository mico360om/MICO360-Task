import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDrawerContainer } from './TaskDrawerContainer';
import { useAuthStore } from '../stores/auth-store';
import { useTaskNotice } from '../lib/task-notice';

// Duplicate from the task panel: "Duplicate…" opens the New task form filled in from the task; once the
// copy is made the panel's task is read again (its "Copies: …" shows the new one).

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const TASK = {
  id: 't12', key: 'MICO-12', title: 'Service the pump', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 0,
  completedAt: null, createdAt: '', updatedAt: '', duplicatedFrom: null, copies: [],
};
const PREFILL = {
  original: { id: 't12', key: 'MICO-12', title: 'Service the pump', projectId: 'p1' },
  task: { title: 'Service the pump', description: null, projectId: 'p1', columnId: 'c1', priority: 'HIGH', startDate: null, dueDate: null, estimatedHours: null, isMilestone: false, weight: null, tags: [], assigneeIds: [], checklists: [], externalContacts: [], inspectionFormId: null, inspectionPlace: null },
  watchers: [],
  files: [],
};
let calls: { method: string; url: string }[] = [];
let copies: { id: string; key: string }[] = [];

beforeEach(() => {
  calls = [];
  copies = [];
  useTaskNotice.setState({ notice: null });
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ method, url: u });
      if (u.endsWith('/tasks/t12/duplicate') && method === 'GET') return json({ data: PREFILL });
      if (u.endsWith('/tasks/t12/duplicate') && method === 'POST') {
        copies = [{ id: 't40', key: 'MICO-40' }];
        return json({ data: { id: 't40', key: 'MICO-40', title: 'Service the pump', projectId: 'p1', columnId: 'c1' }, files: { total: 0, copied: 0, failed: [] } }, 201);
      }
      if (u.endsWith('/projects')) return json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: null, ownerId: null }] });
      if (/\/projects\/p1\/columns/.test(u)) return json({ data: [{ id: 'c1', projectId: 'p1', name: 'To do', category: 'TODO', position: 0, enabled: true }] });
      if (u.includes('/checklist')) return json({ data: { items: [], lists: [], progress: 0 } });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
      if (u.endsWith('/watch')) return json({ data: { watching: false } });
      if (u.endsWith('/tasks/move-targets')) return json({ data: { managesAll: false, managedProjectIds: [], projects: [] } });
      if (u.endsWith('/tasks/t12')) return json({ data: { ...TASK, copies } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TaskDrawerContainer taskId="t12" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('Duplicate from the task panel', () => {
  it('opens the New task form filled in from the task, makes the copy, and the panel then lists it', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Duplicate…' }));
    const form = await screen.findByRole('dialog', { name: 'Duplicate of MICO-12' });
    await waitFor(() => expect(within(form).getByLabelText(/^task title/i)).toHaveValue('Service the pump'));
    await userEvent.click(within(form).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Duplicate of MICO-12' })).toBeNull());
    expect(useTaskNotice.getState().notice).toMatchObject({ text: 'Task MICO-40 created', taskId: 't40' });
    // The panel's task is read again: its copies.
    expect(await screen.findByRole('group', { name: 'Copies' })).toHaveTextContent('Copies: MICO-40');
  });
});
