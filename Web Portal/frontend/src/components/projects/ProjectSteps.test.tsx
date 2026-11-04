import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectSteps } from './ProjectSteps';

// 1.22: "‹ Previous project" and "Next project ›" on a project's page.
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const PROJECTS = [
  { id: 'p1', code: 'OPS', name: 'Operations', status: 'ACTIVE' },
  { id: 'p2', code: 'RIG', name: 'Rig Inspection', status: 'PLANNING' },
  { id: 'p3', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE' },
  { id: 'p9', code: 'OLD', name: 'Archived works', status: 'ARCHIVED' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/projects') ? json({ data: PROJECTS }) : json({ data: [] }))));
});
afterEach(() => vi.unstubAllGlobals());

function Page() {
  const { id = '' } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <ProjectSteps projectId={id} />
      <output data-testid="where">{loc.pathname + loc.search}</output>
      <output data-testid="order">{JSON.stringify((loc.state as { projectOrder?: string[] } | null)?.projectOrder ?? null)}</output>
      <button onClick={() => navigate(-1)}>back</button>
    </>
  );
}
function renderAt(entry: { pathname: string; search?: string; state?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/projects/:id" element={<Page />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectSteps', () => {
  it('opened from the Projects page: its order; each step keeps the tab, and Back works', async () => {
    renderAt({ pathname: '/projects/p2', search: '?tab=team', state: { projectOrder: ['p3', 'p2', 'p1'] } });
    const nav = await screen.findByRole('navigation', { name: 'Step through projects' });
    expect(nav).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Next project' });
    expect(next).toHaveTextContent('Next project');
    // The tooltip names where it leads.
    await waitFor(() => expect(next).toHaveAttribute('title', 'Next project: Operations'));
    await userEvent.click(next);
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p1?tab=team');
    expect(screen.getByTestId('order')).toHaveTextContent('["p3","p2","p1"]');
    expect(screen.getByRole('button', { name: 'Next project' })).toBeDisabled();
    act(() => screen.getByText('back').click());
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p2?tab=team');
    await userEvent.click(screen.getByRole('button', { name: 'Previous project' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p3');
    expect(screen.getByRole('button', { name: 'Previous project' })).toBeDisabled();
  });

  it('opened by a link: the person’s projects that aren’t archived, A–Z', async () => {
    renderAt({ pathname: '/projects/p3' });
    // MICO360 Platform, Operations, Rig Inspection.
    const previous = await screen.findByRole('button', { name: 'Previous project' });
    expect(previous).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next project' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p1');
    expect(screen.getByTestId('order')).toHaveTextContent('["p3","p1","p2"]');
  });

  it('nothing to step through (an archived project opened by link): no buttons', async () => {
    renderAt({ pathname: '/projects/p9' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('navigation', { name: 'Step through projects' })).not.toBeInTheDocument();
  });
});
