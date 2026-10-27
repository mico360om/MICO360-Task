import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormDialog } from './TaskFormDialog';
import type { ApiTask } from '../../api/tasks';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PROJECTS = [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#1E5A8B', icon: null, ownerId: 'u1', clientName: null }];
const COLUMNS = [{ id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#64748b', enabled: true }];
const MEMBERS = [{ id: 'u1', firstName: 'Mona', lastName: 'Owner', username: 'mona', email: '', avatarUrl: null }];
const TEMPLATES = [
  { id: 'tk1', name: 'Weekly site check', title: 'Site check', description: 'Walk round the site', priority: 'HIGH', checklist: ['Gate', 'Fence'], createdById: 'a', createdByName: 'A', canManage: false, createdAt: '', updatedAt: '' },
  { id: 'tk2', name: 'Call the client', title: 'Call the client', description: null, priority: 'LOW', checklist: [], createdById: 'a', createdByName: 'A', canManage: false, createdAt: '', updatedAt: '' },
];

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
let templates: unknown[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  templates = TEMPLATES;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
    if (u.endsWith('/templates/tasks')) return json({ data: templates });
    if (/\/projects\/p1\/columns/.test(u)) return json({ data: COLUMNS });
    if (/\/projects\/p1\/members/.test(u)) return json({ data: MEMBERS });
    if (u.endsWith('/projects')) return json({ data: PROJECTS });
    if (u.endsWith('/users/directory')) return json({ data: MEMBERS });
    if (u.endsWith('/tasks') && method === 'POST') return json({ data: { id: 't99', key: 'MICO-9', title: body?.title, projectId: 'p1', columnId: 'c1' } }, 201);
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(props: Partial<React.ComponentProps<typeof TaskFormDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <TaskFormDialog onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}
const ready = async () => waitFor(() => expect(screen.getByRole('button', { name: 'Column' })).toHaveTextContent('To Do'));
const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/tasks'));
const checklistItems = (dialog: HTMLElement) => within(dialog).queryAllByRole('textbox', { name: /^Checklist item \d+$/ }).map((i) => (i as HTMLInputElement).value);

describe('New task from a task template', () => {
  it('a template fills in the title, description, priority and checklist — all still editable — and the checklist is created with the task', async () => {
    const { onClose } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await ready();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Task template' }));
    await userEvent.click(await screen.findByRole('option', { name: /Weekly site check/ }));
    expect(within(dialog).getByLabelText(/^Task title/)).toHaveValue('Site check');
    expect(within(dialog).getByLabelText(/^Description/)).toHaveValue('Walk round the site');
    expect(within(dialog).getByRole('button', { name: 'Priority' })).toHaveTextContent('High');
    expect(checklistItems(dialog)).toEqual(['Gate', 'Fence']);
    expect(within(dialog).getByRole('status')).toHaveTextContent('Filled in from “Weekly site check”');
    // Still editable before saving.
    await userEvent.clear(within(dialog).getByLabelText(/^Task title/));
    await userEvent.type(within(dialog).getByLabelText(/^Task title/), 'Site check — north gate');
    await userEvent.click(within(dialog).getByRole('button', { name: /Remove “Fence”/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Add a checklist item' }), 'Lights{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create task/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts()[0]!.body).toMatchObject({ title: 'Site check — north gate', description: 'Walk round the site', priority: 'HIGH', checklist: ['Gate', 'Lights'] });
  });

  it('opens filled in from the template asked for (the Templates page’s “Use template”)', async () => {
    renderDialog({ taskTemplateId: 'tk1' });
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await waitFor(() => expect(within(dialog).getByLabelText(/^Task title/)).toHaveValue('Site check'));
    expect(checklistItems(dialog)).toEqual(['Gate', 'Fence']);
  });

  it('a new task can have a checklist without a template; none is sent when it is empty', async () => {
    templates = [];
    const { onClose } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'New task' });
    await ready();
    expect(within(dialog).queryByRole('button', { name: 'Task template' })).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/^Task title/), 'Plain task');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create task/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts()[0]!.body).not.toHaveProperty('checklist');
  });

  it('editing a task offers neither (its checklist is edited in its panel)', async () => {
    const task = { id: 't1', key: 'MICO-12', title: 'Old', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', version: 1, recurrenceRule: null, recurrenceParentId: null } as unknown as ApiTask;
    renderDialog({ task });
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    expect(within(dialog).queryByRole('button', { name: 'Task template' })).toBeNull();
    expect(within(dialog).queryByRole('textbox', { name: 'Add a checklist item' })).toBeNull();
  });
});
