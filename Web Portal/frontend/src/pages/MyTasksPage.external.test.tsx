import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksPage } from './MyTasksPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
const task = (id: string, key: string, title: string, externalSummary: unknown) => ({
  id, key, title, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 20, completedAt: null, createdAt: '', updatedAt: '', externalSummary,
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).includes('/tasks/mine')
      ? json({
          data: [
            task('t1', 'MICO-1', 'Rig inspection', { count: 1, name: 'Ahmed Al Said', company: 'OXY', names: ['Ahmed Al Said'], companies: ['OXY'] }),
            task('t2', 'MICO-2', 'Pipeline survey', { count: 3, name: 'Salim', company: 'PDO', names: ['Salim', 'Ali', 'Huda'], companies: ['PDO', 'oxy'] }),
            task('t3', 'MICO-3', 'Internal only', null),
          ],
        })
      : json({ data: [] })));
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyTasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('My Tasks: external contacts', () => {
  it('each task says who outside the company is responsible', async () => {
    renderPage();
    expect(await screen.findByText('External: Ahmed Al Said (OXY)')).toBeInTheDocument();
    expect(screen.getByText('External: Salim (PDO) and 2 more')).toBeInTheDocument();
  });

  it('filters by external company (case aside)', async () => {
    renderPage();
    await screen.findByText('Rig inspection');
    await userEvent.click(screen.getByRole('button', { name: 'Filter by external company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'PDO' }));
    await waitFor(() => expect(screen.queryByText('Rig inspection')).toBeNull());
    expect(screen.getByText('Pipeline survey')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filter by external company' }));
    await userEvent.click(await screen.findByRole('option', { name: 'OXY' }));
    await waitFor(() => expect(screen.getByText('Rig inspection')).toBeInTheDocument());
    expect(screen.getByText('Pipeline survey')).toBeInTheDocument();
    expect(screen.queryByText('Internal only')).toBeNull();
  });
});
