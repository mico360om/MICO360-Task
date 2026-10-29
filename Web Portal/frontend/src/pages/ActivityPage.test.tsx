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
  it('the old project shows where its task went, by the key it had there (it may not be able to open it now)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{
      id: 'a8', taskId: null, projectId: 'p1', userId: 'u1', action: 'PROJECT_MOVED_OUT', createdAt: new Date().toISOString(),
      meta: { key: 'RIG-4', title: 'Inspect the rig', fromProject: 'Rig Inspection', toProject: 'Operations', toKey: 'OPS-17' },
      actor: { id: 'u1', name: 'Aisha Khan' }, task: null, project: { id: 'p1', name: 'Rig Inspection' },
    }] })));
    renderPage();
    expect(await screen.findByText('moved')).toBeInTheDocument();
    expect(screen.getByText('a task')).toBeInTheDocument();
    const second = screen.getByText(/RIG-4 to Operations \(OPS-17\)/);
    expect(second.closest('p')).toHaveTextContent('Inspect the rig · RIG-4 to Operations (OPS-17) · Rig Inspection');
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

  it('a change made through MICO AI says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [
      { ...activity[0], id: 'a10', meta: { from: 'To Do', to: 'Done', via: 'mico-ai' } },
      { ...activity[1], id: 'a11' },
    ] })));
    renderPage();
    const via = await screen.findAllByText('via MICO AI');
    expect(via).toHaveLength(1);
    expect(via[0]!.closest('li')).toHaveTextContent('Omar Ahmed');
  });

  it('keeps an Arabic task title in its own direction without flipping the whole line to the other side', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ ...activity[0], task: { id: 't9', key: 'MICO-9', title: 'فحص الرافعة الأسبوعي' } }] })));
    renderPage();
    const title = await screen.findByText('فحص الرافعة الأسبوعي');
    expect(title.tagName).toBe('BDI');
    expect(title.closest('[dir="auto"]')).toBeNull();
  });

  it('says which filter is on, not by colour alone', async () => {
    renderPage();
    await screen.findByText('Omar Ahmed');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Moved' }));
    expect(screen.getByRole('button', { name: 'Moved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });
});
