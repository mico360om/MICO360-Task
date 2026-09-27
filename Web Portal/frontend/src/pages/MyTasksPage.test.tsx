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

  it('Space on a row checkbox selects the row instead of opening the task', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MyTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const box = await screen.findByRole('checkbox', { name: 'Select MICO-1' });
    box.focus();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.keyboard(' ');
    expect(box).toBeChecked();
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /task/i })).not.toBeInTheDocument();
  });

  it('says "Due today" (not overdue) for a task due today in the company time zone, and never flags done work', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z')); // 14:00 Muscat
    try {
      const t = (id: string, extra: Record<string, unknown>) => ({ id, key: id.toUpperCase(), title: `Task ${id}`, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'HIGH', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra });
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const u = String(url);
        if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
        if (u.includes('/tasks/mine')) return json({ data: [
          t('a', { dueDate: '2026-09-30T00:00:00.000Z' }),
          t('b', { dueDate: '2026-09-01T00:00:00.000Z', columnCategory: 'DONE' }),
        ] });
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
      expect(await screen.findByText('Due today')).toBeInTheDocument();
      expect(screen.queryByText(/overdue ·/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
