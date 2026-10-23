import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityPage } from './ActivityPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const activity = [
  {
    id: 'a1',
    taskId: 't1',
    projectId: 'p1',
    userId: 'u1',
    action: 'MOVED',
    createdAt: new Date().toISOString(),
    meta: { from: 'To Do', to: 'In Progress' },
    actor: { id: 'u1', name: 'Omar Ahmed' },
    task: { id: 't1', key: 'MICO-7', title: 'Ship the release' },
    project: { id: 'p1', name: 'Mobile App' },
  },
  {
    id: 'a2',
    taskId: 't2',
    projectId: 'p1',
    userId: 'u2',
    action: 'ASSIGNED',
    createdAt: new Date().toISOString(),
    meta: { assignee: 'Nadia Ahmed' },
    actor: { id: 'u2', name: 'Ada Lovelace' },
    task: { id: 't2', key: 'MICO-8', title: 'Write docs' },
    project: { id: 'p1', name: 'Mobile App' },
  },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: activity })));
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ActivityPage />
    </QueryClientProvider>,
  );
}

describe('ActivityPage', () => {
  it('renders a rich feed: who did what, to which task, with the change', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Omar Ahmed')).toBeInTheDocument());
    expect(screen.getByText('moved')).toBeInTheDocument();
    expect(screen.getByText('MICO-7')).toBeInTheDocument();
    expect(screen.getByText(/To Do → In Progress/)).toBeInTheDocument();
    // second entry: an assignment shows the assignee
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText(/→ Nadia Ahmed/)).toBeInTheDocument();
  });

  it('filters the feed by action type', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('MICO-7')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Assigned' }));
    expect(screen.queryByText('MICO-7')).not.toBeInTheDocument(); // the MOVED entry is filtered out
    expect(screen.getByText('MICO-8')).toBeInTheDocument();
  });

  it('a filter with no matches says so, and offers the full list — it does not claim there is no activity', async () => {
    renderPage();
    await screen.findAllByText(/ago|just now/);
    // Pick a kind of activity that the fixture does not contain.
    const chips = ['Created', 'Moved', 'Completed', 'Assigned'];
    for (const name of chips) {
      await userEvent.click(screen.getByRole('button', { name }));
      if (screen.queryByText(/no .* activity/i)) break;
    }
    const empty = screen.getByText(/no .* activity/i);
    expect(empty).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show all activity/i }));
    expect(screen.queryByText(/no .* activity/i)).not.toBeInTheDocument();
  });
  it('a task moved to another project: from where (and its old key) to where', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{
      id: 'a9', taskId: 't4', projectId: 'p2', userId: 'u1', action: 'PROJECT_CHANGED', createdAt: new Date().toISOString(),
      meta: { fromProject: 'Rig Inspection', fromKey: 'RIG-4', toProject: 'Operations', toKey: 'OPS-17' },
      actor: { id: 'u1', name: 'Aisha Khan' }, task: { id: 't4', key: 'OPS-17', title: 'Inspect the rig' }, project: { id: 'p2', name: 'Operations' },
    }] })));
    renderPage();
    expect(await screen.findByText('moved')).toBeInTheDocument();
    expect(screen.getByText('OPS-17')).toBeInTheDocument();
    expect(screen.getByText(/from Rig Inspection \(RIG-4\) to Operations/)).toBeInTheDocument();
  });
});

