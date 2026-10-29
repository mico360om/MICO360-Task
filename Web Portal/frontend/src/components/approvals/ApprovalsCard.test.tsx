import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalsCard } from './ApprovalsCard';
import type { ApprovalTask } from '../../api/tasks';

const api = vi.hoisted(() => ({ approvals: vi.fn() }));
vi.mock('../../api/tasks', async (orig) => ({ ...(await orig<typeof import('../../api/tasks')>()), tasksApi: () => api }));

const row = (n: number): ApprovalTask => ({
  id: `t${n}`, key: `RIG-${n}`, title: `Report ${n}`, description: null, projectId: 'p1', columnId: 'rev', position: 0, priority: 'NORMAL', startDate: null, dueDate: null,
  progress: 0, completedAt: null, createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z', approvalRequestedAt: '2026-10-29T08:00:00Z',
  project: { id: 'p1', code: 'RIG', name: 'Rig Inspection', color: null, icon: null, imageUrl: null }, requestedBy: { id: 'sara', name: 'Sara Ali' },
});
const show = (onOpenTask = vi.fn()) => {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ApprovalsCard onOpenTask={onOpenTask} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onOpenTask;
};

beforeEach(() => api.approvals.mockReset());

describe('Dashboard: Waiting for your approval', () => {
  it('counts and lists the waiting tasks (five at most), each opening the task, with a link to them all', async () => {
    api.approvals.mockResolvedValue({ canApprove: true, tasks: [1, 2, 3, 4, 5, 6, 7].map(row) });
    const onOpen = show();
    const card = await screen.findByTestId('approvals-card');
    expect(within(card).getByRole('heading')).toHaveTextContent('Waiting for your approval (7)');
    expect(within(card).getAllByRole('listitem')).toHaveLength(5);
    expect(within(card).getByText('+2 more on My Tasks.')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Review all' })).toHaveAttribute('href', '/my-tasks#to-approve');
    await userEvent.click(within(card).getByText('Report 1'));
    expect(onOpen).toHaveBeenCalledWith('t1');
  });

  it('nothing waiting: one line, as the other cards', async () => {
    api.approvals.mockResolvedValue({ canApprove: true, tasks: [] });
    show();
    expect(await screen.findByText('Nothing is waiting for your approval.')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Waiting for your approval (0)');
  });

  it('hidden for someone who approves nothing', async () => {
    api.approvals.mockResolvedValue({ canApprove: false, tasks: [] });
    show();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('approvals-card')).toBeNull();
  });
});
