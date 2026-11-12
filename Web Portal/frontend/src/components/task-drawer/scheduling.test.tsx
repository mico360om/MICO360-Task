import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskScheduling } from './scheduling';
import type { ApiTask } from '../../api/tasks';

// Release B x task archive: the task panel's Reminders and Planned time on an archived task — read-only (the server
// answers nobody to plan or remind for, and refuses adding: 409 TASK_ARCHIVED).
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let forPeople: string[] = [];
beforeEach(() => {
  forPeople = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/work-blocks')) return json({ data: [], meta: { forPeople } });
      if (String(url).includes('/reminders')) return json({ data: [], meta: { forPeople } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

const task = (over: Partial<ApiTask> = {}) =>
  ({ id: 't1', key: 'RIG-12', title: 'Pour the slab', projectId: 'p1', startDate: null, dueDate: '2026-11-20', completedAt: null, archivedAt: null, assignees: [{ id: 'ali', name: 'Ali' }], ...over }) as unknown as ApiTask;

const renderPanel = (t: ApiTask) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskScheduling task={t} timeZone="Asia/Muscat" />
    </QueryClientProvider>,
  );

describe('the task panel’s scheduling on an archived task', () => {
  it('says it waits until unarchived, offers no Remind me form and no Plan time', async () => {
    renderPanel(task({ archivedAt: '2026-11-16T06:00:00.000Z' }));
    await userEvent.click(screen.getByRole('button', { name: /Reminders/ }));
    expect(await screen.findByText(/This task is archived — its reminders and planned time wait/)).toBeInTheDocument();
    // Once the server's answer is in (nobody to remind), the form is gone.
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Add reminder' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /Planned time/ }));
    const blocks = screen.getByRole('region', { name: /Planned time/ });
    await within(blocks).findByText('No time planned yet.');
    expect(screen.queryByRole('button', { name: 'Plan time' })).toBeNull();
  });

  it('a live task keeps the Remind me form (for the asker)', async () => {
    forPeople = ['ali'];
    renderPanel(task());
    await userEvent.click(screen.getByRole('button', { name: /Reminders/ }));
    expect(await screen.findByRole('button', { name: 'Add reminder' })).toBeInTheDocument();
    expect(screen.queryByText(/This task is archived/)).toBeNull();
  });
});
