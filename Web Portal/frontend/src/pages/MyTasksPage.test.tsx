import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MyTasksPage } from './MyTasksPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 't1', key: 'MICO-1', title: 'Prepare report', description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 20, completedAt: null, createdAt: '', updatedAt: '' }] })));
});
afterEach(() => vi.restoreAllMocks());

describe('MyTasksPage', () => {
  it('lists the current user’s tasks from /tasks/mine', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyTasksPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Prepare report')).toBeInTheDocument());
  });

  it('opens the task details drawer when a card is clicked', async () => {
    const task = {
      id: 't1', key: 'FIN-2', title: 'Finance Automation: work item 2', description: null,
      projectId: 'p1', columnId: 'c1', position: 0, priority: 'URGENT',
      startDate: null, dueDate: '2026-09-06', progress: 40, completedAt: null,
      createdAt: '', updatedAt: '',
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/tasks/mine')) return json({ data: [task] });
      if (/\/tasks\/t1(\?|$)/.test(u)) return json({ data: task });
      if (u.includes('/dependencies')) return json({ data: { blockedBy: [], blocks: [] } });
      return json({ data: [] });
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const title = await screen.findByText('Finance Automation: work item 2');
    const card = title.closest('[role="button"]');
    expect(card).not.toBeNull();
    fireEvent.click(card as Element);
    // Clicking mounts TaskDrawerContainer, which fetches the single task by id —
    // this is the wiring that was missing (the card had no onClick / no drawer).
    await waitFor(() => expect(calls.some((u) => /\/tasks\/t1(\?|$)/.test(u))).toBe(true));
  });
});
