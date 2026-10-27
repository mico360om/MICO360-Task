import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTemplateEditor, draftProblems } from './ProjectTemplateEditor';
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
    // A new task has no due date; typing a number gives it one.
    expect(within(task).getByRole('checkbox', { name: 'No due date' })).toBeChecked();
    await userEvent.type(within(task).getByRole('textbox', { name: 'Days after the start' }), '3');
    expect(within(task).getByRole('checkbox', { name: 'No due date' })).not.toBeChecked();
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
    expect(within(task).getByRole('textbox', { name: 'Days after the start' })).toHaveValue('0');
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

  it('moves tasks up and down: focus stays on the moved task’s button (the other one at an end), and the move is announced', async () => {
    renderEditor('pt1');
    const dialog = await screen.findByRole('dialog', { name: 'Edit project template' });
    await waitFor(() => expect(within(dialog).getByText('Report')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a task' }));
    await userEvent.type(within(within(dialog).getByRole('group', { name: 'Task 3' })).getByRole('textbox', { name: 'Title' }), 'Close out');
    const titles = () => within(within(dialog).getByRole('list', { name: 'Tasks' })).getAllByTestId('task-title').map((e) => e.textContent);
    const status = within(dialog).getByTestId('move-status');
    // Task 3 up: now second, and its "up" button still has focus.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move task 3 up' }));
    expect(titles()).toEqual(['Inspect', 'Close out', 'Report']);
    expect(within(dialog).getByRole('button', { name: 'Move task 2 up' })).toHaveFocus();
    expect(status).toHaveTextContent('Moved “Close out” to position 2 of 3.');
    // Up again: first, where "up" is unavailable — focus goes to its "down" button.
    await userEvent.keyboard('{Enter}');
    expect(titles()).toEqual(['Close out', 'Inspect', 'Report']);
    expect(within(dialog).getByRole('button', { name: 'Move task 1 down' })).toHaveFocus();
    expect(status).toHaveTextContent('Moved “Close out” to position 1 of 3.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove task 1: Close out' }));
    expect(titles()).toEqual(['Inspect', 'Report']);
  });

  it('moves board columns the same way, with arrows that match their names', async () => {
    renderEditor(null);
    const dialog = screen.getByRole('dialog', { name: 'New project template' });
    const names = () => within(dialog).getAllByRole('textbox', { name: /^Column \d name$/ }).map((i) => (i as HTMLInputElement).value);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move column 2 down' }));
    expect(names()).toEqual(['Backlog', 'In Progress', 'To Do', 'Review', 'Done']);
    expect(within(dialog).getByRole('button', { name: 'Move column 3 down' })).toHaveFocus();
    expect(within(dialog).getByTestId('move-status')).toHaveTextContent('Moved column “To Do” to position 3 of 5.');
    expect(within(dialog).queryByRole('button', { name: /left|right/i })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Move column 3 down' }).querySelector('[data-arrow]')!.getAttribute('data-arrow')).toBe('down');
    expect(within(dialog).getByRole('button', { name: 'Move column 3 up' }).querySelector('[data-arrow]')!.getAttribute('data-arrow')).toBe('up');
  });

  it('Enter in the name, a task’s title or its day box neither saves nor closes the editor', async () => {
    const { onClose } = renderEditor(null);
    const dialog = screen.getByRole('dialog', { name: 'New project template' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Office move{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a task' }));
    const task = within(dialog).getByRole('group', { name: 'Task 1' });
    await userEvent.type(within(task).getByRole('textbox', { name: 'Title' }), 'Book the van{Enter}');
    await userEvent.type(within(task).getByRole('textbox', { name: 'Days after the start' }), '2{Enter}');
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('the day box: a leading “-” doesn’t tick “No due date”; an out-of-range number says so instead of being changed', async () => {
    renderEditor('pt1');
    const dialog = await screen.findByRole('dialog', { name: 'Edit project template' });
    await waitFor(() => expect(within(dialog).getByText('Inspect')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit task 1: Inspect' }));
    const task = within(dialog).getByRole('group', { name: 'Task 1' });
    const box = within(task).getByRole('textbox', { name: 'Days after the start' });
    await userEvent.tripleClick(box);
    await userEvent.keyboard('-');
    expect(within(task).getByRole('checkbox', { name: 'No due date' })).not.toBeChecked();
    await userEvent.keyboard('2');
    expect(within(dialog).getByText('Start − 2 · Inspector · 1 checklist item')).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, '4000');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(within(task).getByText('Use a number from −365 to 3650.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Task 1: the due day must be from 365 days before the start to 3650 days after it.');
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });

  it('checklist text typed but not added is saved with the template, and counts as a change', async () => {
    const { onClose } = renderEditor('pt1');
    const dialog = await screen.findByRole('dialog', { name: 'Edit project template' });
    await waitFor(() => expect(within(dialog).getByText('Inspect')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit task 1: Inspect' }));
    await userEvent.type(within(within(dialog).getByRole('group', { name: 'Task 1' })).getByRole('textbox', { name: 'Add a checklist item' }), 'Pumps');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(requests.find((r) => r.method === 'PUT')!.body).toMatchObject({ tasks: [{ title: 'Inspect', checklist: ['Valves', 'Pumps'] }, { title: 'Report' }] });
  });

  it('a template holds at most 5,000 checklist items in all', () => {
    const task = (i: number) => ({ id: `t${i}`, title: `T${i}`, description: '', priority: 'NORMAL' as const, dueOffsetDays: null, roleKey: null, checklist: Array.from({ length: 100 }, (_, j) => ({ id: `${i}-${j}`, text: `x${j}` })), checklistPending: '' });
    const draft = { name: 'Big', description: '', columns: [{ key: 'c', name: 'To Do', category: 'TODO' as const, color: '#000000' }], roles: [], tasks: Array.from({ length: 51 }, (_, i) => task(i)) };
    expect(draftProblems(draft)).toContain('A template holds at most 5,000 checklist items in all; this one has 5,100.');
    expect(draftProblems({ ...draft, tasks: draft.tasks.slice(0, 50) })).toEqual([]);
  });
});
