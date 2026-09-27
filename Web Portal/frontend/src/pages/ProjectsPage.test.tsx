import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { ProjectsPage } from './ProjectsPage';

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
afterEach(() => vi.restoreAllMocks());

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
