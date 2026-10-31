import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormDialog } from './TaskFormDialog';
import type { ApiTask } from '../../api/tasks';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECTS = [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: null, ownerId: 'u1', clientName: null }];
const COLUMNS = [{ id: 'c1', projectId: 'p1', name: 'Backlog', category: 'TODO', position: 0, color: '#64748b', enabled: true }];
const contact = (id: string, name: string, company: string | null, extra: Record<string, unknown> = {}) => ({
  id, taskId: 't1', name, company, designation: null, email: null, phone: null, remarks: null, position: 0, createdById: 'u1', createdAt: '', updatedAt: '', ...extra,
});
const TASK = {
  id: 't1', key: 'MICO-12', title: 'Rig inspection', description: '', projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL',
  startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', version: 3, recurrenceRule: null, recurrenceParentId: null, recurrenceNextId: null,
  externalContacts: [contact('x1', 'Ahmed', 'OXY'), contact('x2', 'Old Contact', 'Gone Co')],
} as unknown as ApiTask;

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
let failAdd: string | null;
let goneIds: Set<string>;
let added: number;
beforeEach(() => {
  localStorage.clear();
  calls = [];
  failAdd = null;
  goneIds = new Set();
  added = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body });
      if (/\/projects\/p1\/columns/.test(u)) return json({ data: COLUMNS });
      if (/\/projects\/p1\/members/.test(u)) return json({ data: [] });
      if (u.includes('/projects/p1/external-contacts')) return json({ data: [{ name: 'Sara Nasser', company: 'PDO', designation: 'Engineer', email: null, phone: '+968 2222', remarks: null }] });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: 'x', companyName: 'y', serverTime: '' } });
      if (u.endsWith('/tasks') && method === 'POST') return json({ data: { id: 't99', key: 'MICO-9', title: body?.title, projectId: 'p1', columnId: 'c1' } }, 201);
      if (/\/tasks\/t1$/.test(u) && method === 'PUT') return json({ data: { ...TASK, ...body, version: 4 } });
      if (u.endsWith('/tasks/t1/external-contacts') && method === 'POST') {
        if (body?.name === failAdd) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
        return json({ data: contact(`n${++added}`, String(body?.name), (body?.company as string) ?? null) }, 201);
      }
      const one = /\/external-contacts\/(\w+)$/.exec(u)?.[1];
      if (one && goneIds.has(one)) return json({ error: { code: 'NOT_FOUND', message: 'This contact isn’t on the task any more. Someone may have removed it.' } }, 404);
      if (one && method === 'PUT') return json({ data: contact(one, String(body?.name), (body?.company as string) ?? null) });
      if (one && method === 'DELETE') return new Response(null, { status: 204 });
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
const field = () => screen.getByRole('group', { name: 'External contacts' });

describe('Task form: external contacts', () => {
  it('a new task is created with the contacts added in the form (one picked from the project’s earlier ones)', async () => {
    const { onClose } = renderDialog({ projectId: 'p1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
    await userEvent.type(screen.getByLabelText(/^Task title/), 'Rig inspection');
    await userEvent.click(within(field()).getByRole('button', { name: 'Add a contact' }));
    await userEvent.type(within(field()).getByRole('combobox', { name: /^Name/ }), 'Sa');
    await userEvent.click(await screen.findByRole('option', { name: 'Sara Nasser · PDO · Engineer' }));
    await userEvent.click(within(field()).getByRole('button', { name: 'Save' }));
    expect(within(field()).getByText('Sara Nasser')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks'))!;
    expect(create.body?.externalContacts).toEqual([{ name: 'Sara Nasser', company: 'PDO', designation: 'Engineer', email: null, phone: '+968 2222', remarks: null }]);
  });

  it('a contact still being typed in has to be saved (or cancelled) first', async () => {
    renderDialog({ projectId: 'p1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
    await userEvent.type(screen.getByLabelText(/^Task title/), 'Rig inspection');
    await userEvent.click(within(field()).getByRole('button', { name: 'Add a contact' }));
    await userEvent.type(within(field()).getByRole('combobox', { name: /^Name/ }), 'Half typed');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Save the external contact you’re working on, or cancel it, first.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/tasks'))).toBe(false);
  });

  it('editing a task saves each contact change: removed, changed and added', async () => {
    const { onClose } = renderDialog({ task: TASK });
    const f = field();
    expect(within(f).getByText('Ahmed')).toBeInTheDocument();
    await userEvent.click(within(f).getByRole('button', { name: 'Edit Ahmed' }));
    const name = within(f).getByRole('combobox', { name: /^Name/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'Ahmed Al Said');
    await userEvent.click(within(f).getByRole('button', { name: 'Save' }));
    await userEvent.click(within(f).getByRole('button', { name: 'Remove Old Contact' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Remove this contact?' })).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(f).getByRole('button', { name: 'Add a contact' }));
    await userEvent.type(within(f).getByRole('combobox', { name: /^Name/ }), 'Huda');
    await userEvent.click(within(f).getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const contactCalls = calls.filter((c) => c.url.includes('external-contacts') && c.method !== 'GET').map((c) => [c.method, c.url.replace(/^.*\/api\/v1/, ''), c.body]);
    expect(contactCalls).toEqual([
      ['DELETE', '/external-contacts/x2', null],
      // Only what changed is sent, so a field someone else changed meanwhile is kept.
      ['PUT', '/external-contacts/x1', { name: 'Ahmed Al Said' }],
      ['POST', '/tasks/t1/external-contacts', { name: 'Huda', company: null, designation: null, email: null, phone: null, remarks: null }],
    ]);
  });

  it('Enter in a contact’s name box saves that contact, not the task', async () => {
    renderDialog({ projectId: 'p1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
    await userEvent.click(within(field()).getByRole('button', { name: 'Add a contact' }));
    await userEvent.type(within(field()).getByRole('combobox', { name: /^Name/ }), 'Huda{Enter}');
    expect(within(field()).getByText('Huda')).toBeInTheDocument();
    expect(within(field()).queryByRole('combobox', { name: /^Name/ })).toBeNull();
    expect(screen.queryByText('Give the task a title.')).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('a contact added before a failure can still be removed on the next try', async () => {
    failAdd = 'Bader';
    const { onClose } = renderDialog({ task: TASK });
    const f = field();
    for (const name of ['Amal', 'Bader']) {
      await userEvent.click(within(f).getByRole('button', { name: 'Add a contact' }));
      await userEvent.type(within(f).getByRole('combobox', { name: /^Name/ }), `${name}{Enter}`);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Couldn’t save all of the changes/)).toBeInTheDocument();
    await userEvent.click(within(f).getByRole('button', { name: 'Remove Amal' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Remove this contact?' })).getByRole('button', { name: 'Remove' }));
    failAdd = null;
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const writes = calls.filter((c) => c.url.includes('external-contacts') && c.method !== 'GET').map((c) => [c.method, c.url.replace(/^.*\/api\/v1/, ''), c.body?.name ?? null]);
    expect(writes).toEqual([
      ['POST', '/tasks/t1/external-contacts', 'Amal'],
      ['POST', '/tasks/t1/external-contacts', 'Bader'],
      ['DELETE', '/external-contacts/n1', null],
      ['POST', '/tasks/t1/external-contacts', 'Bader'],
    ]);
  });

  it('a contact someone else already removed counts as removed; a change to one is dropped and said, and the rest is saved', async () => {
    goneIds = new Set(['x1', 'x2']);
    const { onClose } = renderDialog({ task: TASK });
    const f = field();
    await userEvent.click(within(f).getByRole('button', { name: 'Remove Old Contact' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Remove this contact?' })).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(f).getByRole('button', { name: 'Edit Ahmed' }));
    await userEvent.type(within(f).getByLabelText('Company'), ' Oman{Enter}');
    await userEvent.click(within(f).getByRole('button', { name: 'Add a contact' }));
    await userEvent.type(within(f).getByRole('combobox', { name: /^Name/ }), 'Huda{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Ahmed had been removed by someone else, so your change to them wasn’t saved. Everything else was saved.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/tasks/t1/external-contacts'))).toBe(true);
    expect(within(f).queryByText('Ahmed')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Nothing is left to save: the next Save just closes.
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/tasks/t1/external-contacts'))).toHaveLength(1);
  });

  it('closing with a contact still being typed in asks first', async () => {
    const { onClose } = renderDialog({ projectId: 'p1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('Backlog'));
    await userEvent.click(within(field()).getByRole('button', { name: 'Add a contact' }));
    await userEvent.type(within(field()).getByRole('combobox', { name: /^Name/ }), 'Half typed');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
