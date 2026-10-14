import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectsPage } from './ProjectsPage';
import { useAuthStore } from '../stores/auth-store';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: 'Internal', status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' },
        ],
      }),
    ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsPage', () => {
  it('loads and renders projects fetched from the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('MICO360 Platform')).toBeInTheDocument());
  });

  it('opens the new-project form for an admin, and the edit form from a card', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /new project/i }));
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit MICO360 Platform' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('MICO360 Platform');
  });
});

describe('ProjectsPage when the projects cannot be loaded', () => {
  it('says so in plain words and loads them on Retry', async () => {
    const ok = fetch;
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (...args: Parameters<typeof fetch>) =>
      fail ? new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }), { status: 500, headers: { 'content-type': 'application/json' } }) : ok(...args),
    ));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load projects.');
    expect(alert).not.toHaveTextContent(/API/);
    fail = false;
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('MICO360 Platform')).toBeInTheDocument());
  });
});

describe('ProjectsPage overdue count', () => {
  afterEach(() => vi.useRealTimers());

  it('counts a task due today (company zone) as not overdue, and a finished one never', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    const t = (id: string, extra: Record<string, unknown>) => ({ id, key: id, title: id, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/config')) return jsonResponse({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      if (u.includes('/tasks')) return jsonResponse({ data: [
        t('a', { dueDate: '2026-09-30T00:00:00.000Z' }),
        t('b', { dueDate: '2026-09-20T00:00:00.000Z', columnCategory: 'DONE' }),
        t('c', { dueDate: '2026-09-29T00:00:00.000Z' }),
      ] });
      if (u.includes('/users/directory')) return jsonResponse({ data: [] });
      return jsonResponse({ data: [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' }] });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByTitle('Overdue')).toHaveTextContent('1'));
  });
});
