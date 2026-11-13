import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SearchPage } from './SearchPage';
import { allQuery, everythingAddress, everythingFilters, hasEverythingFilters } from '../lib/search-everything';

// 1.24: Search results' Guest, Guest company and Category filters (a project's — offered once a project is picked).
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function Where() {
  const { search } = useLocation();
  return <output data-testid="where">{search}</output>;
}
const PROJECTS = [{ id: 'p1', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE' }];
const CATEGORIES = { requireCategory: false, canManage: false, categories: [{ id: 'c1', projectId: 'p1', name: 'Civil', color: 'teal', position: 0, retired: false, retiredAt: null }] };
const GUESTS = [{ id: 'g1', companyId: 'co', name: 'Ahmed', company: 'Acme', designation: null, email: null, phone: null, notes: null, retiredAt: null, mergedIntoId: null, createdById: null, createdAt: '', updatedAt: '' }];
function serve() {
  const asked: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname.endsWith('/search/all')) {
        asked.push(url);
        return json({ data: [], nextCursor: null, total: 0, totalCapped: false, counts: {}, corrected: [] });
      }
      if (url.pathname.endsWith('/projects/p1/categories')) return json({ data: CATEGORIES });
      if (url.pathname.endsWith('/projects/p1/guests')) return json({ data: GUESTS });
      if (url.pathname.endsWith('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
  return asked;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Search results: guests and categories (1.24)', () => {
  it('keeps the filters in the address and asks the server for tasks with them', () => {
    const f = everythingFilters(new URLSearchParams('q=pump&project=p1&category=c1&guest=g1&guestCompany=Acme'));
    expect(f).toMatchObject({ projectId: 'p1', category: 'c1', guest: 'g1', guestCompany: 'Acme', type: 'task' });
    expect(hasEverythingFilters(f)).toBe(true);
    expect(everythingAddress(f)).toBe('q=pump&type=task&project=p1&category=c1&guest=g1&guestCompany=Acme');
    expect(Object.fromEntries(new URLSearchParams(allQuery(f)))).toMatchObject({ category: 'c1', guest: 'g1', guestCompany: 'Acme', type: 'task' });
  });

  it('offers them once a project is picked; picking one asks for tasks', async () => {
    const asked = serve();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/search?q=pump']}>
          <Routes>
            <Route path="/search" element={<><SearchPage debounceMs={0} /><Where /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(screen.queryByLabelText('Category')).toBeNull();
    await userEvent.selectOptions(await screen.findByLabelText('Project'), 'p1');
    await userEvent.selectOptions(await screen.findByLabelText('Category'), 'c1');
    await waitFor(() => expect(Object.fromEntries(asked[asked.length - 1]!.searchParams)).toMatchObject({ projectId: 'p1', category: 'c1', type: 'task' }));
    await userEvent.selectOptions(screen.getByLabelText('Guest'), 'g1');
    await userEvent.selectOptions(screen.getByLabelText('Guest company'), 'Acme');
    await waitFor(() => expect(Object.fromEntries(asked[asked.length - 1]!.searchParams)).toMatchObject({ guest: 'g1', guestCompany: 'Acme' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?q=pump'));
  });
});
