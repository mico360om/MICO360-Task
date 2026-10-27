import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TaskInspections } from './TaskInspections';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  projectId: 'p1',
  title: 'Rig daily check',
  status: 'FINISHED',
  place: 'Rig 3',
  startedAt: '2026-10-27T08:00:00.000Z',
  finishedAt: '2026-10-27T09:00:00.000Z',
  inspector: { id: 'u-ivan', name: 'Ivan Inspector' },
  counts: { total: 3, answered: 3, passed: 2, failed: 1, na: 0 },
  result: '1 failed',
  clientVisible: false,
  task: null,
  ...over,
});
let data: unknown;

beforeEach(() => {
  data = { attached: [item('a')], followUpOf: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      if (u === '/tasks/t1/inspections') return json({ data });
      if (u === '/inspection-forms') return json({ data: { forms: [], canCreate: false } });
      return json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (props: Partial<Parameters<typeof TaskInspections>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TaskInspections taskId="t1" projectId="p1" task={{ id: 't1', key: 'RIG-1', title: 'Inspect rig 3' }} canStart {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('inspections on a task’s panel', () => {
  it('lists the inspections carried out for the task, with their result', async () => {
    show();
    const section = await screen.findByRole('region', { name: 'Inspections' });
    expect(within(section).getByRole('link', { name: /Rig daily check/ })).toHaveAttribute('href', '/inspections/a');
    expect(within(section).getByText('1 failed')).toBeInTheDocument();
  });

  it('says which inspection a follow-up task came from', async () => {
    data = { attached: [], followUpOf: { inspection: item('a'), item: 'Guard rails fitted' } };
    show();
    expect(await screen.findByText(/Follows up/)).toHaveTextContent('Follows up “Guard rails fitted” from the inspection Rig daily check');
    expect(screen.getByRole('link', { name: 'Rig daily check' })).toHaveAttribute('href', '/inspections/a');
  });

  it('starts one for the task', async () => {
    data = { attached: [], followUpOf: null };
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Start an inspection for this task' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start an inspection' });
    expect(within(dialog).getByText('RIG-1')).toBeInTheDocument();
  });

  it('shows nothing at all when there is nothing and it can’t start one', async () => {
    data = { attached: [], followUpOf: null };
    const { container } = show({ canStart: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
  });
});
