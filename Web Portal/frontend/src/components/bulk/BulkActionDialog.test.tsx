import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActionDialog, type BulkDialogType } from './BulkActionDialog';
import type { BulkResult } from '../../api/bulk';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const IDS = ['t1', 't2', 't3'];
let posts: { url: string; body: { taskIds: string[]; action: unknown; dryRun?: boolean } }[] = [];
let answer: (body: { dryRun?: boolean }) => Response;

const result = (over: Partial<BulkResult> = {}): BulkResult => ({
  action: 'status',
  dryRun: true,
  total: 3,
  changed: [
    { id: 't1', key: 'RIG-1', title: 'Pour the slab', projectId: 'p1' },
    { id: 't2', key: 'RIG-2', title: 'Set out', projectId: 'p1', note: { code: 'WAITS_FOR_APPROVAL', text: 'Waits for approval' } },
  ],
  skipped: [{ id: 't3', key: 'OPS-3', title: 'Order steel', code: 'FORBIDDEN', reason: 'You can’t move tasks in Rig 3.' }],
  undo: null,
  ...over,
});

beforeEach(() => {
  posts = [];
  answer = (body) => json({ data: result({ dryRun: !!body.dryRun, undo: body.dryRun ? null : { id: 'b1', until: '2026-11-12T08:00:30.000Z' } }) });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && u.endsWith('/tasks/bulk')) {
        const body = JSON.parse(String(init.body));
        posts.push({ url: u, body });
        return answer(body);
      }
      if (u.endsWith('/projects/p1/members')) {
        return json({ data: [
          { id: 'u1', username: 'sara', email: '', firstName: 'Sara', lastName: 'Al Balushi', role: 'MEMBER' },
          { id: 'u2', username: 'omar', email: '', firstName: 'Omar', lastName: 'Said', role: 'MANAGER' },
        ] });
      }
      if (u.endsWith('/projects/p2/members')) return json({ data: [{ id: 'u3', username: 'lina', email: '', firstName: 'Lina', lastName: 'K', role: 'MEMBER' }] });
      if (u.endsWith('/projects/p1/categories')) {
        return json({ data: { requireCategory: false, canManage: true, categories: [
          { id: 'k1', projectId: 'p1', name: 'Electrical', color: 'blue', position: 0, retired: false, retiredAt: null },
          { id: 'k2', projectId: 'p1', name: 'Civil', color: 'green', position: 1, retired: false, retiredAt: null },
        ] } });
      }
      if (u.includes('/projects/p1/guests')) return json({ data: [{ id: 'g1', name: 'Ahmed Al Harthy', company: 'OXY', designation: null, email: null, phone: null, retiredAt: null }] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function show(type: BulkDialogType, extra: { projectIds?: string[]; onApplied?: (r: BulkResult) => void; onClose?: () => void } = {}) {
  const onApplied = extra.onApplied ?? vi.fn();
  const onClose = extra.onClose ?? vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BulkActionDialog type={type} taskIds={IDS} projectIds={extra.projectIds ?? ['p1']} today="2026-11-11" onClose={onClose} onApplied={onApplied} />
    </QueryClientProvider>,
  );
  return { onApplied, onClose };
}

describe('BulkActionDialog: confirm before applying', () => {
  it('Status: pick one, the dry run is shown (what, how many, skipped and why, notes); Apply sends the same change without dryRun', async () => {
    const { onApplied } = show('status');
    const dialog = screen.getByRole('dialog', { name: 'Change the status of 3 tasks' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await screen.findByRole('dialog', { name: 'Move 3 tasks to Done?' });
    expect(posts[0]!.body).toEqual({ taskIds: IDS, action: { type: 'status', status: 'DONE' }, dryRun: true });
    expect(dialog).toHaveTextContent('2 tasks will change.');
    expect(dialog).toHaveTextContent('1 will be skipped: you can’t move tasks in Rig 3.');
    expect(dialog).toHaveTextContent('1 will wait for approval.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(posts[1]!.body).toEqual({ taskIds: IDS, action: { type: 'status', status: 'DONE' } });
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, undo: expect.objectContaining({ id: 'b1' }) }));
  });

  it('nothing would change: says so, and offers only Close', async () => {
    answer = () => json({ data: result({ changed: [], skipped: IDS.map((id) => ({ id, code: 'UNCHANGED', reason: 'Already High.' })) }) });
    const { onClose } = show('priority');
    await userEvent.click(screen.getByRole('button', { name: 'High' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set the priority of 3 tasks to High?' });
    expect(dialog).toHaveTextContent('Nothing would change.');
    expect(dialog).toHaveTextContent('3 will be skipped: already High.');
    expect(within(dialog).queryByRole('button', { name: 'Apply' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(posts).toHaveLength(1);
  });

  it('Delete, Archive, Duplicate: straight to the check (nothing to choose)', async () => {
    show('delete');
    const dialog = await screen.findByRole('dialog', { name: 'Move 3 tasks to the Recycle Bin?' });
    expect(posts[0]!.body).toEqual({ taskIds: IDS, action: { type: 'delete' }, dryRun: true });
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('a refused check says the server’s words', async () => {
    answer = () => json({ error: { code: 'TOO_MANY', message: 'Duplicate at most 50 tasks at a time.' } }, 400);
    show('duplicate');
    expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate at most 50 tasks at a time.');
  });

  it('Cancel and Escape close without applying', async () => {
    const { onClose } = show('archive');
    await screen.findByRole('dialog', { name: 'Archive 3 tasks?' });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(posts).toHaveLength(1);
  });
});

describe('BulkActionDialog: choosing the change', () => {
  it('Assign: people of the selected tasks’ projects (both projects), several at once', async () => {
    show('assign', { projectIds: ['p1', 'p2'] });
    const dialog = screen.getByRole('dialog', { name: 'Assign people to 3 tasks' });
    const search = within(dialog).getByRole('combobox', { name: 'Add people' });
    await userEvent.click(search);
    expect(await screen.findByRole('option', { name: /Lina K/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Sara Al Balushi/ }));
    await userEvent.click(search);
    await userEvent.click(screen.getByRole('option', { name: /Lina K/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await screen.findByRole('dialog', { name: 'Assign Sara Al Balushi and Lina K to 3 tasks?' });
    expect(posts[0]!.body.action).toEqual({ type: 'assign', userIds: ['u1', 'u3'] });
  });

  it('Continue waits for someone to be picked', async () => {
    show('reassign');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('Unassign everyone (no userIds), or picked people', async () => {
    show('unassign');
    await userEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('dialog', { name: 'Unassign everyone from 3 tasks?' });
    expect(posts[0]!.body.action).toEqual({ type: 'unassign' });
  });

  it('Due date: move them 2 days earlier', async () => {
    show('dueDate');
    await userEvent.click(screen.getByRole('radio', { name: 'Move by days' }));
    const days = screen.getByRole('spinbutton', { name: 'Days' });
    await userEvent.clear(days);
    await userEvent.type(days, '2');
    await userEvent.click(screen.getByRole('radio', { name: 'Earlier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('dialog', { name: 'Move the due dates of 3 tasks 2 days earlier?' });
    expect(posts[0]!.body.action).toEqual({ type: 'dueDate', mode: 'shift', days: -2 });
  });

  it('Due date: clear it', async () => {
    show('dueDate');
    await userEvent.click(screen.getByRole('radio', { name: 'Clear the due date' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('dialog', { name: 'Clear the due date of 3 tasks?' });
    expect(posts[0]!.body.action).toEqual({ type: 'dueDate', mode: 'clear' });
  });

  it('Due date: set a day', async () => {
    show('dueDate');
    const day = screen.getByLabelText('Due date');
    await userEvent.type(day, '2026-11-20');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('dialog', { name: 'Set the due date of 3 tasks to 20 Nov?' });
    expect(posts[0]!.body.action).toEqual({ type: 'dueDate', mode: 'set', date: '2026-11-20' });
  });

  it('Category: the project’s categories to add and to take off', async () => {
    show('category');
    const add = await screen.findByRole('group', { name: 'Add' });
    await userEvent.click(within(add).getByRole('button', { name: 'Electrical' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Take off' })).getByRole('button', { name: 'Civil' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('dialog', { name: 'Add Electrical and take Civil off 3 tasks?' });
    expect(posts[0]!.body.action).toEqual({ type: 'category', add: ['k1'], remove: ['k2'] });
  });

  it('Guests: from the project’s company guest list', async () => {
    show('guests');
    const search = screen.getByRole('combobox', { name: /Search guests/i });
    await userEvent.click(search);
    await userEvent.click(await screen.findByRole('option', { name: /Ahmed Al Harthy/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('dialog', { name: 'Add Ahmed Al Harthy to 3 tasks as a guest?' });
    expect(posts[0]!.body.action).toEqual({ type: 'guests', add: ['g1'] });
  });
});
