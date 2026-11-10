import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormDialog } from './TaskFormDialog';
import type { ApiTask } from '../../api/tasks';
import { CATEGORY_WORDS } from '../../lib/task-categories';

// 1.24 Task categories in the New / Edit task form: a multi-pick from the task's project list.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: null, ownerId: 'u1', clientName: null },
  { id: 'p2', code: 'OPS', name: 'Ops Board', status: 'ACTIVE', color: '#0F766E', icon: null, ownerId: null, clientName: null },
];
const cat = (id: string, name: string, position: number, extra: Record<string, unknown> = {}) => ({ id, projectId: 'p1', name, color: 'teal', position, retired: false, retiredAt: null, ...extra });
const P1_CATS = [cat('k1', 'Electrical', 0, { color: 'indigo' }), cat('k2', 'HSE', 1), cat('k3', 'Old works', 2, { retired: true, retiredAt: '2026-11-01' })];
const TASK = {
  id: 't1', key: 'MICO-12', title: 'Rig inspection', description: '', projectId: 'p1', columnId: 'p1-c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL',
  startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', version: 3, recurrenceRule: null, recurrenceParentId: null, recurrenceNextId: null,
  categories: [{ id: 'k1', name: 'Electrical', color: 'indigo', retired: false }, { id: 'k3', name: 'Old works', color: 'teal', retired: true }],
} as unknown as ApiTask;

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
let requireCategory: boolean;
let setReply: () => Response;
beforeEach(() => {
  localStorage.clear();
  calls = [];
  requireCategory = false;
  setReply = () => json({ data: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body });
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: [{ id: `${cols[1]}-c1`, projectId: cols[1], name: 'Backlog', category: 'TODO', position: 0, color: '#64748b', enabled: true }] });
      if (u.endsWith('/projects/p1/categories')) return json({ data: { requireCategory, categories: P1_CATS, canManage: false } });
      if (u.endsWith('/projects/p2/categories')) return json({ data: { requireCategory: false, categories: [], canManage: false } });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      if (u.endsWith('/tasks') && method === 'POST') return json({ data: { id: 't99', key: 'MICO-9', title: body?.title, projectId: body?.projectId, columnId: body?.columnId } }, 201);
      if (/\/tasks\/t1$/.test(u) && method === 'PUT') return json({ data: { ...TASK, ...body, version: 4 } });
      if (u.endsWith('/tasks/t1/categories') && method === 'PUT') return setReply();
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(props: Partial<React.ComponentProps<typeof TaskFormDialog>> = {}) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskFormDialog onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
const field = () => screen.getByRole('group', { name: /^Categories/ });
const created = () => calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks'));

describe('Task form: categories', () => {
  it('offers the project’s active categories in its colours, and a new task is sent with the ones picked', async () => {
    const { onClose } = renderDialog({ projectId: 'p1' });
    await ready();
    const box = await screen.findByRole('group', { name: /^Categories/ });
    expect(within(box).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Electrical', 'HSE']);
    await userEvent.type(screen.getByLabelText(/^Task title/), 'Cable trays');
    await userEvent.click(within(box).getByRole('button', { name: 'HSE' }));
    expect(within(box).getByRole('button', { name: 'HSE' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(created()!.body?.categoryIds).toEqual(['k2']);
  });

  it('a project without categories: no Categories field, and none sent', async () => {
    const { onClose } = renderDialog({ projectId: 'p2' });
    await ready();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/projects/p2/categories'))).toBe(true));
    expect(screen.queryByRole('group', { name: /^Categories/ })).toBeNull();
    await userEvent.type(screen.getByLabelText(/^Task title/), 'Cable trays');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(created()!.body).not.toHaveProperty('categoryIds');
  });

  it('a project that needs a category: the label says so, and saving without one is blocked', async () => {
    requireCategory = true;
    const { onClose } = renderDialog({ projectId: 'p1' });
    await ready();
    await waitFor(() => expect(field()).toBeInTheDocument());
    expect(screen.getByText('(required)')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Task title/), 'Cable trays');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText(CATEGORY_WORDS.pickOne)).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(created()).toBeUndefined();
    await userEvent.click(within(field()).getByRole('button', { name: 'Electrical' }));
    expect(screen.queryByText(CATEGORY_WORDS.pickOne)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(created()!.body?.categoryIds).toEqual(['k1']);
  });

  it('editing: the task’s categories are picked (a retired one it has stays, marked); an unchanged set isn’t sent', async () => {
    const { onClose } = renderDialog({ task: TASK });
    await ready();
    await waitFor(() => expect(within(field()).getByRole('button', { name: 'Old works (retired)' })).toHaveAttribute('aria-pressed', 'true'));
    expect(within(field()).getByRole('button', { name: 'Electrical' })).toHaveAttribute('aria-pressed', 'true');
    const title = screen.getByLabelText(/^Task title/);
    await userEvent.type(title, ' now');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.some((c) => c.url.endsWith('/tasks/t1/categories'))).toBe(false);
  });

  it('editing: a changed set is saved with the task (only then)', async () => {
    const { onClose } = renderDialog({ task: TASK });
    await ready();
    await waitFor(() => expect(within(field()).getByRole('button', { name: 'Electrical' })).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(within(field()).getByRole('button', { name: 'Old works (retired)' }));
    await userEvent.click(within(field()).getByRole('button', { name: 'HSE' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const put = calls.filter((c) => c.url.endsWith('/tasks/t1/categories'));
    expect(put).toHaveLength(1);
    expect(put[0]!.method).toBe('PUT');
    expect(put[0]!.body).toEqual({ categoryIds: ['k1', 'k2'] });
  });

  it('editing: the server’s refusal is shown and the form stays open', async () => {
    setReply = () => json({ error: { code: 'VALIDATION_ERROR', message: 'Only admins and the project’s managers can change its categories.' } }, 403);
    const { onClose } = renderDialog({ task: TASK });
    await ready();
    await waitFor(() => expect(within(field()).getByRole('button', { name: 'Electrical' })).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(within(field()).getByRole('button', { name: 'HSE' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Only admins and the project’s managers can change its categories\./)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('changing the project clears the categories picked (they are each project’s own)', async () => {
    const { onClose } = renderDialog({ defaultProjectId: 'p1' });
    await ready();
    await userEvent.click(within(await screen.findByRole('group', { name: /^Categories/ })).getByRole('button', { name: 'HSE' }));
    await userEvent.click(screen.getByRole('button', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Ops Board/ }));
    await ready();
    await waitFor(() => expect(screen.queryByRole('group', { name: /^Categories/ })).toBeNull());
    await userEvent.type(screen.getByLabelText(/^Task title/), 'Cable trays');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(created()!.body).not.toHaveProperty('categoryIds');
    expect(created()!.body?.projectId).toBe('p2');
  });
});
