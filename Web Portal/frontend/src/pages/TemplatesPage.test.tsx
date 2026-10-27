import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TemplatesPage } from './TemplatesPage';
import { TEMPLATE_TABS } from '../components/templates/template-tabs';
import { useAuthStore } from '../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const projectTemplates = [
  { id: 'pt1', name: 'Rig inspection', description: 'Our standard inspection', columnCount: 5, roleCount: 2, taskCount: 12, createdById: 'lead', createdByName: 'Omar Ahmed', canManage: true, createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-20T08:00:00Z' },
  { id: 'pt2', name: 'Office move', description: null, columnCount: 3, roleCount: 0, taskCount: 1, createdById: 'admin', createdByName: 'Khurram Admin', canManage: false, createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-02T08:00:00Z' },
];
const taskTemplates = [
  { id: 'tk1', name: 'Weekly site check', title: 'Site check', description: 'Walk round', priority: 'HIGH', checklist: ['Gate', 'Fence'], createdById: 'lead', createdByName: 'Omar Ahmed', canManage: true, createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-02T08:00:00Z' },
];

let requests: { url: string; method: string }[];

function signIn(roles: string[]) {
  useAuthStore.getState().setSession({ user: { id: roles.includes('ADMIN') ? 'admin' : 'lead', email: 'a@x', username: 'a', roles }, accessToken: 'at', refreshToken: 'rt' });
}

beforeEach(() => {
  requests = [];
  signIn(['EMPLOYEE']);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    requests.push({ url: u, method });
    if (u.endsWith('/templates/projects') && method === 'GET') return json({ data: projectTemplates });
    if (u.endsWith('/templates/tasks') && method === 'GET') return json({ data: taskTemplates });
    if (/\/templates\/projects\/pt1$/.test(u) && method === 'DELETE') return new Response(null, { status: 204 });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(path = '/templates') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <TemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Templates page', () => {
  it('is built from a list of tabs another feature can add to', () => {
    expect(TEMPLATE_TABS.map((t) => [t.key, t.label])).toEqual([['projects', 'Projects'], ['tasks', 'Tasks']]);
    for (const t of TEMPLATE_TABS) expect(t.element).toBeTruthy();
  });

  it('shows the Projects tab first, with each template’s tasks, roles and board', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Templates' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Projects', 'Tasks']);
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true');
    const card = (await screen.findByRole('heading', { name: 'Rig inspection' })).closest('article')!;
    expect(within(card).getByText('12 tasks')).toBeInTheDocument();
    expect(within(card).getByText('2 roles')).toBeInTheDocument();
    expect(within(card).getByText('5 columns')).toBeInTheDocument();
    expect(within(card).getByText(/Omar Ahmed/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Use Rig inspection' })).toBeInTheDocument();
    // Only templates you may change offer Edit and Delete.
    expect(within(card).getByRole('button', { name: 'More actions for Rig inspection' })).toBeInTheDocument();
    const other = screen.getByRole('heading', { name: 'Office move' }).closest('article')!;
    expect(within(other).getByText('1 task')).toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('only administrators get “New template”; everyone else is told how to save one', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Rig inspection' });
    expect(screen.queryByRole('button', { name: /New project template/ })).toBeNull();
    expect(screen.getByText(/save it as a template from the project’s page/i)).toBeInTheDocument();
  });

  it('administrators can start a new project template', async () => {
    signIn(['ADMIN']);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /New project template/ }));
    expect(await screen.findByRole('dialog', { name: 'New project template' })).toBeInTheDocument();
  });

  it('opens a tab from the address, and switches tabs with the arrow keys', async () => {
    renderPage('/templates?tab=tasks');
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
    const card = (await screen.findByRole('heading', { name: 'Weekly site check' })).closest('article')!;
    expect(within(card).getByText('2 checklist items')).toBeInTheDocument();
    expect(within(card).getByText('High')).toBeInTheDocument();
    screen.getByRole('tab', { name: 'Tasks' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveFocus();
  });

  it('deletes a template after asking', async () => {
    renderPage();
    const card = (await screen.findByRole('heading', { name: 'Rig inspection' })).closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'More actions for Rig inspection' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const ask = screen.getByRole('alertdialog', { name: 'Delete “Rig inspection”?' });
    expect(ask).toHaveTextContent(/Projects already made from it stay as they are/);
    await userEvent.click(within(ask).getByRole('button', { name: 'Delete template' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/templates/projects/pt1'))).toBe(true));
  });

  it('“Use” on a project template opens the New project form starting from it', async () => {
    renderPage();
    const card = (await screen.findByRole('heading', { name: 'Rig inspection' })).closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Use Rig inspection' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    expect(within(dialog).getByRole('button', { name: /Template/ })).toHaveTextContent('Rig inspection');
  });
});
