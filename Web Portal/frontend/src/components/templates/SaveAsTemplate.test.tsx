import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SaveProjectTemplateDialog, SaveTaskTemplateDialog } from './SaveAsTemplate';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const draft = {
  project: { id: 'p1', name: 'Rig 7' },
  base: { day: '2026-11-01', from: 'start' },
  taskCount: 12,
  columnCount: 5,
  columnsTotal: 5,
  maxTasks: 500,
  checklistItems: 30,
  maxChecklistItems: 5000,
  checklistTrimmed: 0,
  // Omar is on tasks 1–3 (first on 1 and 3), Sara on 1–2 (first on 2); task 4 has nobody.
  assignments: [['u-omar', 'u-sara'], ['u-sara', 'u-omar'], ['u-omar'], []],
  people: [
    { id: 'u-omar', name: 'Omar Ahmed', taskCount: 3 },
    { id: 'u-sara', name: 'Sara Said', taskCount: 2 },
  ],
};

let requests: { url: string; method: string; body?: unknown }[];
let override: (u: string, method: string) => Response | undefined;

beforeEach(() => {
  requests = [];
  override = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url: u, method, body });
    const o = override(u, method);
    if (o) return o;
    if (u.endsWith('/templates/projects/from-project/p1') && method === 'GET') return json({ data: draft });
    if (u.endsWith('/templates/projects/from-project/p1') && method === 'POST') return json({ data: { id: 'ptNew', name: (body as { name: string }).name } }, 201);
    if (u.endsWith('/templates/tasks/from-task/t1') && method === 'POST') return json({ data: { id: 'tkNew', name: (body as { name?: string }).name ?? 'Kick-off' } }, 201);
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderIt(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Save a project as a template', () => {
  it('says what it takes, lets the saver name a role for each person on its tasks, and saves', async () => {
    const onClose = vi.fn();
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Save as template' });
    expect(within(dialog).getByLabelText(/^Template name/)).toHaveValue('Rig 7');
    expect(await within(dialog).findByText(/its board \(5 columns\) and its 12 tasks/)).toBeInTheDocument();
    expect(within(dialog).getByText(/days from the project’s start, Sun 1 Nov 2026/)).toBeInTheDocument();
    const omar = within(dialog).getByRole('textbox', { name: 'Role for Omar Ahmed' });
    await userEvent.type(omar, 'Inspector');
    await userEvent.clear(within(dialog).getByLabelText(/^Template name/));
    await userEvent.type(within(dialog).getByLabelText(/^Template name/), 'Rig standard');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(await within(dialog).findByText('Saved “Rig standard” as a template.')).toBeInTheDocument();
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.body).toEqual({ name: 'Rig standard', description: null, roles: [{ userId: 'u-omar', name: 'Inspector' }], includeDescriptions: true });
    expect(within(dialog).getByRole('link', { name: 'Open Templates' })).toHaveAttribute('href', '/templates');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says, before saving, that everyone will see it — and can leave the task descriptions out', async () => {
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save as template' });
    await within(dialog).findByText(/12 tasks/);
    // Shown before anything is saved.
    expect(within(dialog).getByText('Everyone in the company will be able to see this template’s task titles, descriptions and checklists.')).toBeVisible();
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    const keep = within(dialog).getByRole('checkbox', { name: 'Include task descriptions' });
    expect(keep).toBeChecked();
    await userEvent.click(keep);
    expect(within(dialog).getByText('Everyone in the company will be able to see this template’s task titles and checklists.')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await within(dialog).findByText(/as a template\./);
    expect(requests.find((r) => r.method === 'POST')!.body).toMatchObject({ includeDescriptions: false });
  });

  it('Enter in a role box (or the name) neither saves nor closes the dialog', async () => {
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save as template' });
    await within(dialog).findByText(/12 tasks/);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Role for Omar Ahmed' }), 'Inspector{Enter}');
    await userEvent.type(within(dialog).getByLabelText(/^Template name/), '{Enter}');
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(within(dialog).getByRole('button', { name: 'Save template' })).toBeInTheDocument();
  });

  it('shows what each role really gets: the first of a task’s people who has a role names it', async () => {
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save as template' });
    await within(dialog).findByText(/12 tasks/);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Role for Omar Ahmed' }), 'Inspector');
    // Only Omar has a role: every task he is on names it (Sara is first on task 2, but has none).
    expect(within(dialog).getByTestId('role-for-u-omar')).toHaveTextContent('Inspector gets all 3 of these tasks');
    expect(within(dialog).getByTestId('role-summary')).toHaveTextContent('Inspector: 3 tasks. 1 task will be unassigned');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Role for Sara Said' }), 'Site lead');
    // Task 2 now names Sara's role: she is first on it.
    expect(within(dialog).getByTestId('role-for-u-omar')).toHaveTextContent('Inspector gets 2 of these 3 tasks');
    expect(within(dialog).getByTestId('role-for-u-sara')).toHaveTextContent('Site lead gets 1 of these 2 tasks');
    expect(within(dialog).getByTestId('role-summary')).toHaveTextContent('Inspector: 2 tasks · Site lead: 1 task. 1 task will be unassigned');
  });

  it('says when someone given a role won’t become one', async () => {
    override = (u, method) => (u.endsWith('/from-project/p1') && method === 'GET' ? json({ data: { ...draft, assignments: [['u-omar', 'u-sara']], people: [{ id: 'u-omar', name: 'Omar Ahmed', taskCount: 1 }, { id: 'u-sara', name: 'Sara Said', taskCount: 1 }] } }) : undefined);
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save as template' });
    await within(dialog).findByText(/12 tasks/);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Role for Omar Ahmed' }), 'Inspector');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Role for Sara Said' }), 'Driver');
    expect(within(dialog).getByTestId('role-for-u-sara')).toHaveTextContent('“Driver” won’t become a role: each of these tasks names another role first.');
  });

  it('says what saving leaves out: columns past 20, checklist items past 100 a task — and refuses more than 5,000 items in all', async () => {
    override = (u, method) => (u.endsWith('/from-project/p1') && method === 'GET' ? json({ data: { ...draft, columnsTotal: 24, columnCount: 20, checklistTrimmed: 2 } }) : undefined);
    const { unmount } = render(<div />);
    unmount();
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={() => {}} />);
    let dialog = screen.getByRole('dialog', { name: 'Save as template' });
    expect(await within(dialog).findByText('Only the first 20 of its 24 columns are kept.')).toBeInTheDocument();
    expect(within(dialog).getByText('2 tasks have more than 100 checklist items: only their first 100 are kept.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save template' })).toBeEnabled();
    cleanup();
    override = (u, method) => (u.endsWith('/from-project/p1') && method === 'GET' ? json({ data: { ...draft, checklistItems: 5400 } }) : undefined);
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={() => {}} />);
    dialog = screen.getByRole('dialog', { name: 'Save as template' });
    expect(await within(dialog).findByText('Its checklists hold 5,400 items in all; a template can hold at most 5,000.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save template' })).toBeDisabled();
  });

  it('a project with more tasks than a template holds can’t be saved, and says so', async () => {
    override = (u, method) => (u.endsWith('/from-project/p1') && method === 'GET' ? json({ data: { ...draft, taskCount: 612 } }) : undefined);
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save as template' });
    expect(await within(dialog).findByText(/612 tasks; a template can hold at most 500/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save template' })).toBeDisabled();
  });

  it('a refusal is shown in the dialog', async () => {
    override = (u, method) => (u.endsWith('/from-project/p1') && method === 'POST' ? json({ error: { code: 'FORBIDDEN', message: 'Only this project’s owner, its managers or an administrator can save it as a template.' } }, 403) : undefined);
    renderIt(<SaveProjectTemplateDialog projectId="p1" projectName="Rig 7" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save as template' });
    await within(dialog).findByText(/12 tasks/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only this project’s owner, its managers or an administrator can save it as a template.');
  });
});

describe('Save a task as a template', () => {
  it('names it after the task (changeable) and saves its title, description, priority and checklist', async () => {
    renderIt(<SaveTaskTemplateDialog taskId="t1" taskTitle="Kick-off" checklistCount={2} hasDescription onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save task as template' });
    expect(within(dialog).getByText(/title, description, priority and checklist \(2 items\)/)).toBeInTheDocument();
    expect(within(dialog).getByText('Everyone in the company will be able to see this template’s task title, description and checklist.')).toBeVisible();
    expect(within(dialog).getByLabelText(/^Template name/)).toHaveValue('Kick-off');
    await userEvent.type(within(dialog).getByLabelText(/^Template name/), ' meeting');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(await within(dialog).findByText('Saved “Kick-off meeting” as a task template.')).toBeInTheDocument();
    await waitFor(() => expect(requests.find((r) => r.method === 'POST')!.body).toEqual({ name: 'Kick-off meeting', includeDescription: true }));
  });

  it('can leave the task’s description out', async () => {
    renderIt(<SaveTaskTemplateDialog taskId="t1" taskTitle="Kick-off" checklistCount={0} hasDescription onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save task as template' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Include its description' }));
    expect(within(dialog).getByText('Everyone in the company will be able to see this template’s task title and checklist.')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(requests.find((r) => r.method === 'POST')!.body).toEqual({ name: 'Kick-off', includeDescription: false }));
  });
});
