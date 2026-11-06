import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';

// 1.23.6 The top bar: the first row says what the words were read as and how many items that finds
// (Enter opens it on the Search page); an empty box offers the saved searches, pinned first with counts.
function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GlobalSearch debounceMs={0} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const saved = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, q: name.toLowerCase(), filters: {}, owner: { id: 'me', name: 'Me' }, mine: true, shared: null, pinned: false, updatedAt: '2026-11-07T08:00:00.000Z', ...over });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GlobalSearch — 1.23.6 advanced search', () => {
  it('the first row: “Tasks · Overdue · MICO · Assigned to me → 7”; Enter opens the Search page with those words', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/search?q=')) {
        return Promise.resolve(json({ data: { tasks: [], projects: [], users: [], meetings: [], more: [], understood: { chips: [{ key: 'kind', label: 'Tasks', text: 'tasks' }, { key: 'due', label: 'Overdue', text: 'overdue' }, { key: 'project', label: 'MICO', text: 'MICO' }, { key: 'assignee', label: 'Assigned to me', text: 'assigned to me' }], words: '', removed: [], total: 7, capped: false } } }));
      }
      return Promise.resolve(json({ data: [] }));
    }));
    setup();
    const box = screen.getByRole('searchbox', { name: /search/i });
    await userEvent.type(box, 'Show overdue MICO tasks assigned to me');
    const row = await screen.findByRole('button', { name: /Tasks · Overdue · MICO · Assigned to me/ });
    expect(row).toHaveTextContent('→ 7');
    expect(row).toHaveAttribute('data-active', 'true');
    // The words themselves find nothing, but the row does: no "Nothing matches" above it.
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
    expect(screen.getByText('Search with filters')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/search?q=Show+overdue+MICO+tasks+assigned+to+me'));
  });

  it('plain words: no such row', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(json(String(url).includes('/search?q=') ? { data: { tasks: [], projects: [], users: [], meetings: [], more: [] } } : { data: [] }))));
    setup();
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'pump repair');
    await screen.findByText(/See all results/);
    expect(screen.queryByText('Search with filters')).toBeNull();
  });

  it('an empty box offers the saved searches: pinned first, with their counts; one opens the Search page', async () => {
    const list = { mine: [saved('s1', 'Mine unpinned'), saved('s2', 'Overdue of mine', { pinned: true, filters: { type: 'task' } })], shared: [saved('s3', 'Team late', { mine: false, owner: { id: 'u2', name: 'Cat' }, shared: { projectId: 'p1', code: 'MICO', name: 'MICO360' } })], pinned: ['s2'] };
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url);
      asked.push(u);
      if (u.endsWith('/search/saved')) return Promise.resolve(json({ data: list }));
      if (u.includes('/search/saved/counts')) return Promise.resolve(json({ data: { s2: { total: 3, capped: false } } }));
      return Promise.resolve(json({ data: [] }));
    }));
    setup();
    await userEvent.click(screen.getByRole('searchbox', { name: /search/i }));
    await screen.findByText('Saved searches');
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '').filter((t) => /Mine unpinned|Overdue of mine|Team late/.test(t));
    expect(names[0]).toContain('Overdue of mine');
    await waitFor(() => expect(screen.getByRole('button', { name: /Overdue of mine/ })).toHaveTextContent('→ 3'));
    expect(screen.getByRole('button', { name: /Team late/ })).toHaveTextContent('Shared by Cat · MICO');
    expect(asked.some((u) => u.includes('/search/saved/counts?ids=s2'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Overdue of mine/ }));
    expect(screen.getByTestId('where').textContent).toBe('/search?q=overdue+of+mine&type=task');
  });
});
