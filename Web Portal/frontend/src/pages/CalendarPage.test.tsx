import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarPage } from './CalendarPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/tasks')) {
        return json({ data: [{ id: 't1', key: 'MICO-1', title: 'Prepare report', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: '2026-06-15T09:00:00Z', progress: 0, completedAt: null, createdAt: '', updatedAt: '' }] });
      }
      return json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO360', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', createdAt: '', updatedAt: '' }] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CalendarPage />
    </QueryClientProvider>,
  );
}

describe('CalendarPage', () => {
  it('renders a month grid with weekday headers and view toggles', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument();
    // month grid weekday header row appears once data loads
    await waitFor(() => expect(screen.getByText('Sun')).toBeInTheDocument());
    expect(screen.getByText('Sat')).toBeInTheDocument();
  });

  it('shows a task (with its due date) in the Agenda view', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
  });
});
