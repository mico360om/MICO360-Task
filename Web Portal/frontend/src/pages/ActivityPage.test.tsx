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
});
