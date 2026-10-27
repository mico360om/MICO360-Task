import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SaveProjectTemplateDialog, SaveTaskTemplateDialog } from './SaveAsTemplate';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const draft = {
  project: { id: 'p1', name: 'Rig 7' },
  base: { day: '2026-11-01', from: 'start' },
  taskCount: 12,
  columnCount: 5,
  maxTasks: 500,
  people: [
    { id: 'u-omar', name: 'Omar Ahmed', taskCount: 7 },
    { id: 'u-sara', name: 'Sara Said', taskCount: 3 },
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
    const omar = within(dialog).getByRole('textbox', { name: 'Role for Omar Ahmed (7 tasks)' });
    await userEvent.type(omar, 'Inspector');
    await userEvent.clear(within(dialog).getByLabelText(/^Template name/));
    await userEvent.type(within(dialog).getByLabelText(/^Template name/), 'Rig standard');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(await within(dialog).findByText('Saved “Rig standard” as a template.')).toBeInTheDocument();
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.body).toEqual({ name: 'Rig standard', description: null, roles: [{ userId: 'u-omar', name: 'Inspector' }] });
    expect(within(dialog).getByRole('link', { name: 'Open Templates' })).toHaveAttribute('href', '/templates');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
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
    renderIt(<SaveTaskTemplateDialog taskId="t1" taskTitle="Kick-off" checklistCount={2} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Save task as template' });
    expect(within(dialog).getByText(/title, description, priority and checklist \(2 items\)/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Template name/)).toHaveValue('Kick-off');
    await userEvent.type(within(dialog).getByLabelText(/^Template name/), ' meeting');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(await within(dialog).findByText('Saved “Kick-off meeting” as a task template.')).toBeInTheDocument();
    await waitFor(() => expect(requests.find((r) => r.method === 'POST')!.body).toEqual({ name: 'Kick-off meeting' }));
  });
});
