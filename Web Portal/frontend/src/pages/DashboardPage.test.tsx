import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  useAuthStore.getState().setSession({
    user: { id: 'u1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] },
    accessToken: 'at',
    refreshToken: 'rt',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/reports/status')) return json({ data: { TODO: 1, DONE: 2 } });
      if (u.endsWith('/reports/projects')) return json({ data: [{ projectId: 'p1', projectName: 'P1', total: 7, completed: 3, overdue: 2, completionPct: 43 }] });
      if (u.endsWith('/tasks/mine')) return json({ data: [] });
      if (u.includes('/projects')) return json({ data: [{ id: 'p1' }, { id: 'p2' }] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  it('greets the user and shows live stat tiles from the API', async () => {
    renderPage();
    expect(screen.getByText(/welcome back, admin/i)).toBeInTheDocument();
    expect(screen.getByText('My tasks')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument()); // all-tasks total (unique)
  });
});
