import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectFormDialog } from './ProjectFormDialog';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const templates = [
  { id: 'pt1', name: 'Rig inspection', description: null, columnCount: 3, roleCount: 2, taskCount: 3, createdById: 'admin', createdByName: 'Admin', canManage: true, createdAt: '', updatedAt: '' },
];
const plan = (start: string) => ({
  template: {
    id: 'pt1', name: 'Rig inspection', description: null, updatedAt: '',
    columns: [{ name: 'Backlog', category: 'BACKLOG', color: '#948985' }, { name: 'To Do', category: 'TODO', color: '#3A6EA5' }, { name: 'Done', category: 'DONE', color: '#2E7D53' }],
    roles: [{ id: 'r-insp', name: 'Inspector' }, { id: 'r-lead', name: 'Site lead' }],
  },
  startDate: start,
  today: '2026-10-27',
  workingDays: [0, 1, 2, 3, 4],
  startColumn: 1,
  tasks: [
    { position: 0, title: 'Kick-off', priority: 'HIGH', dueDate: start, movedFrom: null, offset: 0, roleId: 'r-lead', checklistCount: 2, hasDescription: false },
    { position: 1, title: 'Inspect', priority: 'NORMAL', dueDate: start === '2026-11-01' ? '2026-11-08' : '2026-10-11', movedFrom: start === '2026-11-01' ? '2026-11-06' : '2026-10-09', offset: 5, roleId: 'r-insp', checklistCount: 0, hasDescription: true },
    { position: 2, title: 'Report', priority: 'LOW', dueDate: null, movedFrom: null, offset: null, roleId: null, checklistCount: 0, hasDescription: false },
  ],
  overdue: start < '2026-10-27' ? 2 : 0,
  moved: 1,
});

let requests: { url: string; method: string; body?: unknown }[];
let override: (u: string, method: string) => Response | undefined;

beforeEach(() => {
  requests = [];
  override = () => undefined;
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-27T06:00:00Z') });
  useAuthStore.getState().setSession({ user: { id: 'emp', email: 'e@x', username: 'sara', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url: u, method, body });
    const o = override(u, method);
    if (o) return o;
    if (u.includes('/projects/code-check')) {
      const code = new URL(u, 'http://t').searchParams.get('code')!.toUpperCase();
      return json({ data: { code, valid: true, available: true } });
    }
    if (u.endsWith('/templates/projects') && method === 'GET') return json({ data: templates });
    if (u.includes('/templates/projects/pt1/plan')) return json({ data: plan(new URL(u, 'http://t').searchParams.get('start')!) });
    if (u.endsWith('/templates/projects/pt1/projects') && method === 'POST') return json({ data: { id: 'pNew', code: (body as { code: string }).code, name: (body as { name: string }).name, taskCount: 3 } }, 201);
    if (u.endsWith('/users/directory')) {
      return json({
        data: [
          { id: 'emp', username: 'sara', firstName: 'Sara', lastName: 'Said', active: true },
          { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Ahmed', active: true },
          { id: 'u3', username: 'layla', firstName: 'Layla', lastName: 'Gone', active: false },
        ],
      });
    }
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderForm(props: Partial<React.ComponentProps<typeof ProjectFormDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ProjectFormDialog onClose={onClose} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}

async function pickTemplate(dialog: HTMLElement, name: string) {
  await userEvent.click(within(dialog).getByRole('button', { name: /Template/ }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('New project from a template', () => {
  it('offers templates; a chosen one shows the tasks it will create, from today, with who does each', async () => {
    renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    expect(within(dialog).getByRole('button', { name: /Template/ })).toHaveTextContent('Blank project');
    await pickTemplate(dialog, 'Rig inspection');
    const start = within(dialog).getByLabelText('Start date');
    expect(start).toHaveValue('2026-10-27');
    const list = await within(dialog).findByRole('list', { name: 'Tasks it will create' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // A long list scrolls in its box: it can be reached from the keyboard to scroll it.
    expect(list).toHaveAttribute('tabindex', '0');
    expect(rows[0]).toHaveTextContent('Kick-off');
    expect(rows[0]).toHaveTextContent('Site lead');
    expect(rows[2]).toHaveTextContent('No due date');
    expect(rows[2]).toHaveTextContent('Owner');
    expect(within(dialog).getByText(/3 tasks on a board of 3 columns/)).toBeInTheDocument();
    // Days off are named, so a moved date is no surprise.
    expect(within(dialog).getByText(/Friday or Saturday/)).toBeInTheDocument();
  });

  it('picks people for roles (active people only), shows them on the tasks, and creates it all in one request', async () => {
    const { onSaved } = renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await pickTemplate(dialog, 'Rig inspection');
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(requests.some((r) => r.url.includes('start=2026-11-01'))).toBe(true));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Person for Inspector' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options.some((t) => t?.includes('Layla'))).toBe(false);
    await userEvent.click(screen.getByRole('option', { name: /Omar Ahmed/ }));
    const list = within(dialog).getByRole('list', { name: 'Tasks it will create' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Omar Ahmed'));
    // Moved off a day off: said on the row.
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent(/moved from Fri/i);
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Rig 8');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create project/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.url).toMatch(/\/templates\/projects\/pt1\/projects$/);
    expect(post.body).toMatchObject({ name: 'Rig 8', code: 'R8I', startDate: '2026-11-01', roles: { 'r-insp': 'u2' } });
    expect(requests.some((r) => r.method === 'POST' && /\/api\/v1\/projects$/.test(r.url))).toBe(false);
  });

  it('warns when a past start date makes tasks overdue at once', async () => {
    renderForm({ templateId: 'pt1' });
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /Template/ })).toHaveTextContent('Rig inspection'));
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-10-04' } });
    expect(await within(dialog).findByText(/2 tasks will be overdue as soon as the project is created/)).toBeInTheDocument();
  });

  it('a template changed meanwhile: says so and keeps the form', async () => {
    override = (u, method) => (u.endsWith('/templates/projects/pt1/projects') && method === 'POST' ? json({ error: { code: 'VALIDATION', message: 'This template was changed while you were filling in the form. Pick the people for its roles again.', details: { code: 'TEMPLATE_CHANGED' } } }, 400) : undefined);
    const { onClose } = renderForm({ templateId: 'pt1' });
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await within(dialog).findByRole('list', { name: 'Tasks it will create' });
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Rig 9');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create project/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This template was changed while you were filling in the form');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('back to a blank project creates it the usual way', async () => {
    const { onSaved } = renderForm({ templateId: 'pt1' });
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await pickTemplate(dialog, 'Blank project');
    expect(within(dialog).queryByLabelText('Start date')).toBeNull();
    override = (u, method) => (u.endsWith('/projects') && method === 'POST' ? json({ data: { id: 'pBlank', code: 'BL', name: 'Blank' } }, 201) : undefined);
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Blank');
    await userEvent.click(within(dialog).getByRole('button', { name: /Create project/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.some((r) => r.method === 'POST' && r.url.includes('/templates/'))).toBe(false);
  });

  it('closing after changing the start date (or the people for roles) asks first', async () => {
    const { onClose } = renderForm({ templateId: 'pt1' });
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    await within(dialog).findByRole('list', { name: 'Tasks it will create' });
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-11-01' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a project without an owner leaves the unfilled tasks unassigned, and the preview says so', async () => {
    useAuthStore.getState().setSession({ user: { id: 'admin', email: 'a@x', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    renderForm({ templateId: 'pt1' });
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    const list = await within(dialog).findByRole('list', { name: 'Tasks it will create' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Owner' }));
    await userEvent.click(screen.getByRole('option', { name: 'No owner' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent('Unassigned'));
  });

  it('editing a project offers no template', async () => {
    renderForm({ project: { id: 'p1', code: 'MICO', name: 'MICO', description: null, clientName: null, status: 'ACTIVE', priority: 'NORMAL', color: '#8B1E1E', imageUrl: null, ownerId: null, startDate: null, targetDate: null, createdAt: '', updatedAt: '' } });
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).queryByRole('button', { name: /Template/ })).toBeNull();
  });
});
