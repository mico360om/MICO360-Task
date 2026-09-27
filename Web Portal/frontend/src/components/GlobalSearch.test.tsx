import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function setup(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.restoreAllMocks());

describe('GlobalSearch', () => {
  it('queries the search endpoint (debounced) and shows results', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(json({ data: { tasks: [{ id: 't1', key: 'MICO-1', title: 'Prepare report', projectId: 'p1' }], projects: [{ id: 'p1', code: 'MICO', name: 'MICO Ops' }], users: [] } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'mico');

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/search?q=mico'))).toBe(true));
    expect(await screen.findByText('Prepare report')).toBeInTheDocument();
    expect(screen.getByText('MICO Ops')).toBeInTheDocument();
  });

  it('does not search for very short queries', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(json({ data: { tasks: [], projects: [], users: [] } })));
    vi.stubGlobal('fetch', fetchMock);
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'a');
    // give any debounce a chance
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/search'))).toBe(false);
  });

  it('offers a "go to" navigation command', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [], projects: [], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'go to calendar');
    expect(await screen.findByText(/Go to Calendar/i)).toBeInTheDocument();
  });

  it('offers an "open" command for a bare task key', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [], projects: [], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'MICO-7');
    expect(await screen.findByText(/Open MICO-7/i)).toBeInTheDocument();
  });

  it('never acts on a different task when the typed key has no exact match (WEB-5 vs WEB-50)', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/search')) return Promise.resolve(json({ data: { tasks: [{ id: 't50', key: 'WEB-50', title: 'Other task', projectId: 'p1' }], projects: [], users: [] } }));
      return Promise.resolve(json({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'complete WEB-5{Enter}');
    expect(await screen.findByText('No task WEB-5.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/move') || String(c[0]).includes('/columns'))).toBe(false);
  });
});
