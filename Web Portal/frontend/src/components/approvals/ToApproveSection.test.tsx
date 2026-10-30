import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToApproveSection } from './ToApproveSection';
import { ApiError } from '../../lib/api-client';
import type { ApprovalTask } from '../../api/tasks';

const api = vi.hoisted(() => ({ approvals: vi.fn(), approve: vi.fn(), sendBack: vi.fn() }));
vi.mock('../../api/tasks', async (orig) => ({ ...(await orig<typeof import('../../api/tasks')>()), tasksApi: () => api }));

const row = (id: string, key: string, title: string, over: Partial<ApprovalTask> = {}): ApprovalTask => ({
  id, key, title, description: null, projectId: 'p1', columnId: 'rev', columnCategory: 'REVIEW', position: 0, priority: 'NORMAL', startDate: null, dueDate: null,
  progress: 50, completedAt: null, createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z', version: 4, needsApproval: true,
  approvalRequestedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), approvalRequestedById: 'sara',
  project: { id: 'p1', code: 'RIG', name: 'Rig Inspection', color: '#8B1E1E', icon: null, imageUrl: null },
  requestedBy: { id: 'sara', name: 'Sara Ali' },
  ...over,
});

const show = (onOpen = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToApproveSection onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return onOpen;
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});

describe('My Tasks: To approve', () => {
  it('lists what waits for my approval, with who finished it, and opens a task', async () => {
    api.approvals.mockResolvedValue({ canApprove: true, tasks: [row('t1', 'RIG-4', 'Pressure test report'), row('t2', 'RIG-7', 'تقرير الفحص')] });
    const onOpen = show();
    const list = await screen.findByRole('region', { name: 'To approve (2)' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByText(/Finished by/)[0]).toHaveTextContent('Finished by Sara Ali · 3h ago');
    expect(within(list).getByText('تقرير الفحص').tagName).toBe('BDI');
    await userEvent.click(within(list).getByRole('button', { name: 'Open RIG-4: Pressure test report' }));
    expect(onOpen).toHaveBeenCalledWith('t1');
  });

  it('approve from the list: done, said so, and the list refreshes', async () => {
    api.approvals.mockResolvedValueOnce({ canApprove: true, tasks: [row('t1', 'RIG-4', 'Pressure test report')] }).mockResolvedValue({ canApprove: true, tasks: [] });
    api.approve.mockResolvedValue({ ...row('t1', 'RIG-4', 'Pressure test report'), columnId: 'done', approvalRequestedAt: null });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve RIG-4' }));
    expect(api.approve).toHaveBeenCalledWith('t1', 4);
    expect(await screen.findByRole('status')).toHaveTextContent('Approved RIG-4.');
    await waitFor(() => expect(screen.queryByRole('region', { name: /To approve/ })).toBeNull());
  });

  it('send back from the list asks for a reason, then sends it', async () => {
    api.approvals.mockResolvedValue({ canApprove: true, tasks: [row('t1', 'RIG-4', 'Pressure test report')] });
    api.sendBack.mockResolvedValue({ ...row('t1', 'RIG-4', 'Pressure test report'), columnId: 'doing', approvalRequestedAt: null });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Send RIG-4 back' }));
    await userEvent.type(screen.getByLabelText('Why are you sending it back?'), 'Wrong revision');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send back' }));
    expect(api.sendBack).toHaveBeenCalledWith('t1', 'Wrong revision', 4);
    expect(await screen.findByRole('status')).toHaveTextContent('Sent RIG-4 back.');
  });

  it('someone else approved it first: says so on the row', async () => {
    api.approvals.mockResolvedValue({ canApprove: true, tasks: [row('t1', 'RIG-4', 'Pressure test report')] });
    api.approve.mockRejectedValue(new ApiError(409, 'NOT_WAITING', 'This task isn’t waiting for approval any more.'));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve RIG-4' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This task isn’t waiting for approval any more.');
  });

  it('nothing waiting, or someone who approves nothing: no section', async () => {
    api.approvals.mockResolvedValue({ canApprove: false, tasks: [] });
    show();
    await waitFor(() => expect(api.approvals).toHaveBeenCalled());
    expect(screen.queryByRole('region')).toBeNull();
  });
});
