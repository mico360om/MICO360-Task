import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectsPage } from './ProjectsPage';
import type { ProjectOverview } from '../api/projects';

// In a browser, React Router 7 applies a search-params change as a transition: the address (and
// anything read back from it) catches up a moment later. Tests flush transitions at once, so here
// the setter is made to land late on purpose — the page must not depend on reading it straight back.
vi.mock('react-router-dom', async (importOriginal) => {
  const rr = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...rr,
    useSearchParams: (...args: Parameters<typeof rr.useSearchParams>) => {
      const [params, set] = rr.useSearchParams(...args);
      const late: typeof set = (...a) => void setTimeout(() => set(...a), 40);
      return [params, late] as ReturnType<typeof rr.useSearchParams>;
    },
  };
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const project = (id: string, name: string, status: ProjectOverview['status'], extra: Partial<ProjectOverview> = {}): ProjectOverview => ({
  id, code: id.toUpperCase(), number: null, name, clientName: null, status, color: '#3A6EA5', icon: null,
  imageUrl: null, ownerId: null, targetDate: null, owner: null, team: [], teamCount: 0, mine: false, stats: { total: 0, done: 0, open: 0, overdue: 0, nextDue: null, lastActivityAt: '2026-10-20T00:00:00.000Z' }, ...extra,
});
const LIST = [
  project('p1', 'Rig Inspection Portal', 'ACTIVE', { clientName: 'Gulf Energy' }),
  project('p2', 'Falcon CRM', 'ON_HOLD'),
  project('p3', 'Mobile App', 'PLANNING'),
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => (String(input).endsWith('/projects/overview') ? json({ data: LIST }) : json({ data: [] }))));
});
afterEach(() => vi.restoreAllMocks());

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<><ProjectsPage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const cardNames = () => screen.queryAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/projects/')).map((a) => a.textContent);

describe('ProjectsPage while the address catches up', () => {
  it('keeps every key typed in the search box', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Rig Inspection Portal' });
    const box = screen.getByRole('searchbox', { name: 'Search projects' });
    await userEvent.type(box, 'gulf portal');
    expect(box).toHaveValue('gulf portal');
    expect(cardNames()).toEqual(['Rig Inspection Portal']);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/projects?q=gulf+portal'));
  });

  it('moves one tab per arrow key, however fast they come', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Rig Inspection Portal' });
    screen.getByRole('tab', { name: /^All/ }).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('tab', { name: /^Planning/ })).toHaveAttribute('aria-selected', 'true');
    expect(cardNames()).toEqual(['Mobile App']);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/projects?status=planning'));
    // The address catching up step by step never pulls the page back.
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByRole('tab', { name: /^Planning/ })).toHaveAttribute('aria-selected', 'true');
  });
});
