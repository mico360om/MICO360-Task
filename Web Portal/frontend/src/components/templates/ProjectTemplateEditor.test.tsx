import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTemplateEditor } from './ProjectTemplateEditor';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const stored = {
  id: 'pt1', name: 'Rig inspection', description: 'Standard', columnCount: 2, roleCount: 1, taskCount: 2, createdById: 'admin', createdByName: 'Admin', canManage: true, createdAt: '', updatedAt: '',
  columns: [{ name: 'To Do', category: 'TODO', color: '#3A6EA5' }, { name: 'Done', category: 'DONE', color: '#2E7D53' }],
  roles: [{ id: 'r-insp', name: 'Inspector' }],
  tasks: [
    { id: 'tt1', title: 'Inspect', description: 'Walk it', priority: 'HIGH', dueOffsetDays: 5, roleId: 'r-insp', checklist: ['Valves'] },
    { id: 'tt2', title: 'Report', description: null, priority: 'NORMAL', dueOffsetDays: null, roleId: null, checklist: [] },
  ],
};

let requests: { url: string; method: string; body?: unknown }[];

beforeEach(() => {
  requests = [];
  useAuthStore.getState().setSession({ user: { id: 'admin', email: 'a@x', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url: u, method, body });
    if (u.endsWith('/templates/projects/pt1') && method === 'GET') return json({ data: stored });
    if (u.endsWith('/templates/projects') && method === 'POST') return json({ data: { ...stored, ...(body as object), id: 'ptNew' } }, 201);
    if (u.endsWith('/templates/projects/pt1') && method === 'PUT') return json({ data: { ...stored, ...(body as object) } });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderEditor(templateId: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ProjectTemplateEditor templateId={templateId} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('Project template editor', () => {
  it('creates a template: its board (the usual one to start), a role, and a task naming it with a due offset and a checklist', async () => {
    const { onClose } = renderEditor(null);
    const dialog = screen.getByRole('dialog', { name: 'New project template' });
    // The usual board to begin with.
    const board = within(dialog).getByRole('group', { name: 'Board columns' });
    expect(within(board).getAllByRole('textbox', { name: /^Column \d name$/ }).map((i) => (i as HTMLInputElement).value)).toEqual(['Backlog', 'To Do', 'In Progress', 'Review', 'Done']);
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Office move');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a role' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Role 1 name' }), 'Driver');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a task' }));
    const task = within(dialog).getByRole('group', { name: 'Task 1' });
    await userEvent.type(within(task).getByRole('textbox', { name: 'Title' }), 'Book the van');
    fireEvent.change(within(task).getByRole('spinbutton', { name: 'Days after the start' }), { target: { value: '3' } });
    await userEvent.selectOptions(within(task).getByRole('combobox', { name: 'Who does it' }), 'Driver');
    await userEvent.type(within(task).getByRole('textbox', { name: 'Add a checklist item' }), 'Call the company{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.body).toMatchObject({
      name: 'Office move',
      columns: [{ name: 'Backlog' }, { name: 'To Do' }, { name: 'In Progress' }, { name: 'Review' }, { name: 'Done' }],
      roles: [{ name: 'Driver' }],
      tasks: [{ title: 'Book the van', priority: 'NORMAL', dueOffsetDays: 3, checklist: ['Call the company'] }],
    });
    const body = post.body as { roles: { key: string }[]; tasks: { roleKey: string }[] };
    expect(body.tasks[0]!.roleKey).toBe(body.roles[0]!.key);
  });

  it('edits a template, keeping its roles (by their ids) for projects being made from it', async () => {
    const { onClose } = renderEditor('pt1');
    const dialog = await screen.findByRole('dialog', { name: 'Edit project template' });
    await waitFor(() => expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Rig inspection'));
    // Each task shows as a line: its title, when it is due and who does it.
    expect(within(dialog).getByText('Inspect')).toBeInTheDocument();
    expect(within(dialog).getByText('Start + 5 · Inspector · 1 checklist item')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit task 2: Report' }));
    const task = within(dialog).getByRole('group', { name: 'Task 2' });
    await userEvent.click(within(task).getByRole('checkbox', { name: 'No due date' }));
    expect(within(task).getByRole('spinbutton', { name: 'Days after the start' })).toHaveValue(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.body).toMatchObject({
      name: 'Rig inspection',
      roles: [{ key: 'r-insp', name: 'Inspector' }],
      tasks: [
        { title: 'Inspect', dueOffsetDays: 5, roleKey: 'r-insp', checklist: ['Valves'], priority: 'HIGH', description: 'Walk it' },
        { title: 'Report', dueOffsetDays: 0, roleKey: null },
      ],
    });
  });

  it('says what is missing before saving: a name, task titles, a column tasks can start in, distinct role names', async () => {
    renderEditor(null);
    const dialog = screen.getByRole('dialog', { name: 'New project template' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a task' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a role' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Role 1 name' }), 'Lead');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a role' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Role 2 name' }), 'lead');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveTextContent('Give the template a name.');
    expect(alert).toHaveTextContent('Task 1 needs a title.');
    expect(alert).toHaveTextContent('Two roles are called “lead”.');
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('moves tasks up and down, and removes them', async () => {
    renderEditor('pt1');
    const dialog = await screen.findByRole('dialog', { name: 'Edit project template' });
    await waitFor(() => expect(within(dialog).getByText('Report')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move task 2 up' }));
    const titles = () => within(within(dialog).getByRole('list', { name: 'Tasks' })).getAllByTestId('task-title').map((e) => e.textContent);
    expect(titles()).toEqual(['Report', 'Inspect']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove task 1: Report' }));
    expect(titles()).toEqual(['Inspect']);
  });
});
