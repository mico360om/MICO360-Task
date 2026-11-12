import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectFormDialog } from './ProjectFormDialog';
import { useAuthStore } from '../../stores/auth-store';
import type { ApiProject } from '../../api/projects';
import { CATEGORY_WORDS } from '../../lib/task-categories';

/** 1.24 The Edit project window's Categories section: saved on its own, never through the window's Save. */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const existing: ApiProject = {
  id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: '', clientName: '', status: 'ACTIVE', priority: 'HIGH',
  color: '#8B1E1E', icon: null, imageUrl: null, ownerId: 'u1', startDate: null, targetDate: null, createdAt: '', updatedAt: '',
};

let requests: { url: string; method: string; body?: unknown }[];
let categories: { id: string; projectId: string; name: string; color: string; position: number; retired: boolean; retiredAt: null; taskCount: number }[];

beforeEach(() => {
  requests = [];
  categories = [{ id: 'a', projectId: 'p1', name: 'Electrical', color: 'teal', position: 0, retired: false, retiredAt: null, taskCount: 0 }];
  useAuthStore.getState().setSession({ user: { id: 'admin', email: 'a@x', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    requests.push({ url: u, method, body });
    if (u.endsWith('/projects/p1/categories') && method === 'GET') return json({ data: { requireCategory: false, canManage: true, categories } });
    if (u.endsWith('/projects/p1/categories') && method === 'POST') {
      const made = { id: `n${categories.length}`, projectId: 'p1', ...(body as { name: string; color: string }), position: categories.length, retired: false, retiredAt: null, taskCount: 0 };
      categories.push(made);
      return json({ data: made }, 201);
    }
    if (/\/project-categories\/\w+$/.test(u) && method === 'PUT') return json({ data: { ...categories[0], ...(body as object) } });
    if (u.endsWith('/projects') && method === 'GET') return json({ data: [existing] });
    if (/\/projects\/\w+$/.test(u) && method === 'PUT') return json({ data: { ...existing, ...(body as object) } });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'u1', username: 'ada', firstName: 'Ada', lastName: 'Lovelace' }] });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderForm(project: ApiProject | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ProjectFormDialog project={project} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}

const section = () => screen.getByRole('region', { name: /^Categories/ });

describe('Edit project → Categories', () => {
  it('shows the project’s categories in the window; adding one (Enter) saves it at once and leaves the window open', async () => {
    const { onClose, onSaved } = renderForm(existing);
    const dialog = screen.getByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByRole('region', { name: /^Categories/ })).toBeInTheDocument();
    await within(section()).findByRole('list', { name: 'Categories, in order' });
    expect(within(section()).getByText('Changes to categories save straight away.')).toBeInTheDocument();

    await userEvent.type(within(section()).getByRole('textbox', { name: 'Category name' }), 'Civil{Enter}');
    await waitFor(() => expect(requests.filter((r) => r.method === 'POST' && r.url.endsWith('/projects/p1/categories'))).toHaveLength(1));
    // Not the window's Save: the project itself isn't sent, the window stays.
    expect(requests.filter((r) => r.method === 'PUT' && /\/projects\/p1$/.test(r.url))).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit project' })).toBeInTheDocument();
    await waitFor(() => expect(within(section()).getAllByRole('listitem')).toHaveLength(2));

    // Nothing else changed: closing doesn't ask about unsaved changes.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape while renaming a category leaves the rename, not the window', async () => {
    const { onClose } = renderForm(existing);
    await within(section()).findByRole('list', { name: 'Categories, in order' });
    await userEvent.click(within(section()).getByRole('button', { name: 'Rename Electrical' }));
    await userEvent.type(within(section()).getByRole('textbox', { name: 'New name for Electrical' }), 'x{Escape}');
    expect(within(section()).queryByRole('textbox', { name: 'New name for Electrical' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit project' })).toBeInTheDocument();
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });

  it('a new project says categories come once it is saved (nothing asked of the server)', () => {
    renderForm(null);
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    expect(within(dialog).getByText('Categories are added once the project is saved.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: /^Categories/ })).toBeNull();
    expect(requests.filter((r) => r.url.includes('/categories'))).toHaveLength(0);
  });

  it('someone who isn’t one of its managers sees the list, not the controls', async () => {
    useAuthStore.getState().setSession({ user: { id: 'emp', email: 'e@x', username: 'emp', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
    vi.mocked(fetch).mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith('/projects/p1/categories')) return json({ data: { requireCategory: false, canManage: false, categories: categories.map(({ taskCount: _t, ...c }) => c) } });
      return json({ data: [] });
    });
    renderForm(existing);
    await within(section()).findByRole('list', { name: 'Categories, in order' });
    expect(within(section()).getByText(CATEGORY_WORDS.notManager)).toBeInTheDocument();
    expect(within(section()).queryByRole('textbox')).toBeNull();
    expect(within(section()).getByRole('switch', { name: CATEGORY_WORDS.require })).toBeDisabled();
  });
});
