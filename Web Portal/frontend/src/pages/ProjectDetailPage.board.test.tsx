import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { ProjectDetailPage } from './ProjectDetailPage';
import { useAuthStore } from '../stores/auth-store';
import { useTaskSteps } from '../lib/task-steps';
import { BOARD_FIT_QUERY } from '../lib/board';
import { CurrentProjectProvider, useCurrentProjectId } from '../components/CurrentProject';

// 1.22.3 (owner, 4 Nov — "On project page show the Kanban Board also"): a Board tab after Overview,
// the project's own Kanban board inside its page — the Board page's board, not a copy.

// Live updates: a stand-in socket (the page's and the board's).
type Handler = (...a: unknown[]) => void;
const socketHandlers: Record<string, Handler> = {};
const fakeSocket = { on: vi.fn((ev: string, cb: Handler) => { socketHandlers[ev] = cb; }), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECT = { id: 'p1', code: 'MICO', name: 'MICO Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', ownerId: null, createdAt: '', updatedAt: '', canManage: true };
const COLUMNS = [
  { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#111', enabled: true },
  { id: 'c2', projectId: 'p1', name: 'In Progress', category: 'IN_PROGRESS', position: 1, color: '#222', enabled: true },
];
const task = (id: string, columnId: string, position: number) => ({
  id, key: `MICO-${id.slice(1)}`, title: `Task ${id}`, description: null, projectId: 'p1', columnId, position, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '',
});
const TASKS = [task('t2', 'c2', 0), task('t3', 'c1', 1), task('t1', 'c1', 0)];

let calls: string[] = [];
let project: Record<string, unknown> = PROJECT;
beforeEach(() => {
  calls = [];
  project = PROJECT;
  localStorage.clear();
  useTaskSteps.getState().clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@b.c', username: 'manager', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push(method === 'GET' ? u : `${method} ${u}`);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
    if (u.endsWith('/me/companies')) return json({ data: { companies: [], primaryCompanyId: null, allArchived: false, siteCompanyCount: 1 } });
    if (u.includes('/client-shares')) return json({ data: [] });
    if (u.includes('/members')) return json({ data: [{ id: 'u1', username: 'manager', email: '', firstName: 'Mona', lastName: 'M', role: 'MANAGER', hasAccess: true }] });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'u1', username: 'manager', firstName: 'Mona', lastName: 'M', avatarUrl: null }] });
    if (u.includes('/columns')) return json({ data: COLUMNS });
    if (u.endsWith('/meetings-overview')) return json({ data: { meetings: [], decisions: [], actionItems: [], series: [], stats: { upcoming: 0, ongoing: 0, completed: 0, cancelled: 0, nextMeetingId: null, openActionItems: 0, overdueActionItems: 0, decisions: 0 } } });
    if (u.endsWith('/projects/p1/inspections')) return json({ data: { inspections: [], canStart: true } });
    if (u.endsWith('/projects')) return json({ data: [project] });
    if (u.includes('/tasks')) return json({ data: TASKS });
    return json({ data: project });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

/** A window that is wide and tall enough for the board to fit it (BOARD_FIT_QUERY), or not. */
function windowFits(fits: boolean) {
  const mm = vi.fn((q: string) => ({ matches: fits && q === BOARD_FIT_QUERY, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
  vi.stubGlobal('matchMedia', mm);
  Object.defineProperty(window, 'matchMedia', { value: mm, configurable: true, writable: true });
}

/** The project the header's New task starts in. */
function CurrentProjectIs() {
  return <p data-testid="current-project">{useCurrentProjectId() ?? 'none'}</p>;
}

/** Where the page is (path and address settings), and a way to go Back / Forward. */
function Where() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="where">{loc.pathname + loc.search}</p>
      <button type="button" onClick={() => navigate(-1)}>History back</button>
      <button type="button" onClick={() => navigate(1)}>History forward</button>
    </>
  );
}

function renderPage(path = '/projects/p1?tab=board', before: string[] = []) {
  return render(
    <MemoryRouter initialEntries={[...before, path]} initialIndex={before.length}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CurrentProjectProvider>
          <Routes>
            <Route path="/projects/:id" element={<><ProjectDetailPage /><Where /><CurrentProjectIs /></>} />
            <Route path="/projects" element={<Where />} />
          </Routes>
        </CurrentProjectProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent;

describe('ProjectDetailPage: the Board tab (1.22.3)', () => {
  it('comes after Overview: Overview · Board · Tasks · Meetings · Inspections · KPIs · Team', async () => {
    renderPage('/projects/p1');
    const tabs = within(await screen.findByRole('tablist', { name: 'Project dashboard' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.replace(/\d+$/, ''))).toEqual(['Overview', 'Board', 'Tasks', 'Meetings', 'Inspections', 'KPIs', 'Team']);
  });

  it('?tab=board shows this project’s Kanban board inside the page: its columns and cards, under the page’s own header', async () => {
    renderPage();
    const panel = await screen.findByRole('tabpanel', { name: 'Board' });
    expect(within(panel).getByRole('region', { name: 'Board columns' })).toBeInTheDocument();
    const todo = await within(panel).findByRole('region', { name: 'To Do' });
    expect(within(todo).getByText('Task t1')).toBeInTheDocument();
    expect(within(within(panel).getByRole('region', { name: 'In Progress' })).getByText('Task t2')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    // This project's board (no other project's, no All projects).
    expect(calls.some((c) => c.includes('/projects/p1/columns'))).toBe(true);
    expect(calls.some((c) => /\/tasks\?projectId=p1&boardDate=\d{4}-\d\d-\d\d$/.test(c))).toBe(true);
    // One header: the project page's. No "Kanban Board" title, breadcrumb or project picker inside.
    expect(screen.queryByRole('heading', { name: 'Kanban Board' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['MICO Platform']);
    expect(within(panel).queryByRole('button', { name: 'Select project' })).toBeNull();
    expect(within(panel).queryByRole('navigation')).toBeNull();
  });

  it('has what the Board page has: the day, the people strip, Manage columns and New task', async () => {
    renderPage();
    const panel = await screen.findByRole('tabpanel', { name: 'Board' });
    await within(panel).findByRole('region', { name: 'To Do' });
    expect(within(panel).getByLabelText('Board date')).toBeInTheDocument();
    expect(await within(panel).findByRole('button', { name: /People on this project: 1/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Manage columns' })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /\+ new task/i }));
    expect(await screen.findByRole('dialog', { name: /new task/i })).toBeInTheDocument();
  });

  it('is chosen in the address: the Board tab sets ?tab=board, Overview takes it off, and Back / Forward follow', async () => {
    renderPage('/projects/p1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Board' }));
    expect(where()).toBe('/projects/p1?tab=board');
    expect(await screen.findByRole('region', { name: 'Board columns' })).toBeInTheDocument();
    // A card opened from the board: its task in the panel (?task=), the tab kept.
    await userEvent.click(await screen.findByText('Task t3'));
    expect(where()).toBe('/projects/p1?tab=board&task=t3');
    await userEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(where()).toBe('/projects/p1?tab=board');
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'History forward' }));
    expect(where()).toBe('/projects/p1?tab=board&task=t3');
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(where()).toBe('/projects/p1?task=t3');
    expect(screen.queryByRole('region', { name: 'Board columns' })).toBeNull();
  });

  it('Back leaves the page from the Board tab, and Forward comes back to it (the tab is in the address)', async () => {
    renderPage('/projects/p1', ['/projects']);
    await userEvent.click(await screen.findByRole('tab', { name: 'Board' }));
    expect(await screen.findByRole('region', { name: 'Board columns' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(where()).toBe('/projects');
    await userEvent.click(screen.getByRole('button', { name: 'History forward' }));
    expect(where()).toBe('/projects/p1?tab=board');
    expect(await screen.findByRole('region', { name: 'Board columns' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a card opens with the board as its list: Previous / Next go column by column, top to bottom', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Task t2'));
    expect(useTaskSteps.getState()).toMatchObject({ ids: ['t1', 't3', 't2'], path: '/projects/p1' });
  });

  it('fits a laptop like the Board page (each column scrolls); a phone scrolls the page and the columns sideways', async () => {
    windowFits(true);
    const { unmount } = renderPage();
    expect(await screen.findByRole('region', { name: 'Board columns' })).toHaveAttribute('data-fit', 'true');
    unmount();
    windowFits(false);
    renderPage();
    const columns = await screen.findByRole('region', { name: 'Board columns' });
    expect(columns).toHaveAttribute('data-fit', 'false');
    expect(columns.className).toMatch(/overflow-x-auto/);
  });

  it('an archived project’s board is there to look at, as on the Board page', async () => {
    project = { ...PROJECT, status: 'ARCHIVED', canManage: true };
    renderPage();
    const panel = await screen.findByRole('tabpanel', { name: 'Board' });
    expect(await within(panel).findByRole('region', { name: 'To Do' })).toBeInTheDocument();
    expect(within(within(panel).getByRole('region', { name: 'To Do' })).getByText('Task t1')).toBeInTheDocument();
  });

  it('1.22.3 review: an archived or completed project’s board is read-only — no New task, column +, Manage columns, card menu or dragging; it says why, and cards still open', async () => {
    for (const [look, words] of [
      [{ status: 'ARCHIVED' }, 'This project is archived — reopen it first.'],
      [{ status: 'ACTIVE', archived: true }, 'This project is archived — reopen it first.'], // all its companies archived
      [{ status: 'COMPLETED' }, 'This project is completed — reopen it first.'],
    ] as const) {
      project = { ...PROJECT, ...look, canManage: true };
      const { unmount } = renderPage();
      const panel = await screen.findByRole('tabpanel', { name: 'Board' });
      const todo = await within(panel).findByRole('region', { name: 'To Do' });
      expect(within(panel).getByText(words).closest('[role="status"]'), look.status).not.toBeNull();
      expect(within(panel).queryByRole('button', { name: /\+ new task/i })).toBeNull();
      expect(within(panel).queryByRole('button', { name: 'Manage columns' })).toBeNull();
      expect(within(panel).queryByRole('button', { name: /^Add a task to/ })).toBeNull();
      expect(within(panel).queryByRole('button', { name: /^More actions for/ })).toBeNull();
      // A card can't be picked up (it isn't a draggable "sortable"), and nothing says to drop one.
      const card = panel.querySelector('[data-card-key="MICO-1"]')!;
      expect(card).not.toHaveAttribute('aria-roledescription');
      expect(card).not.toHaveAttribute('aria-disabled');
      expect(within(panel).queryByText(/drop a card here/i)).toBeNull();
      // …and still opens its task.
      await userEvent.click(within(todo).getByText('Task t1'));
      expect(where()).toBe('/projects/p1?tab=board&task=t1');
      unmount();
    }
  });

  it('1.22.3 review: an open project’s board keeps every change (no read-only notice)', async () => {
    renderPage();
    const panel = await screen.findByRole('tabpanel', { name: 'Board' });
    await within(panel).findByRole('region', { name: 'To Do' });
    expect(within(panel).queryByText(/reopen it first/)).toBeNull();
    expect(within(panel).getAllByRole('button', { name: /^Add a task to/ }).length).toBeGreaterThan(0);
    expect(panel.querySelector('[data-card-key="MICO-1"]')).toHaveAttribute('aria-roledescription', 'sortable');
  });

  it('leaving the Board tab keeps New task in this project (the page says which project it is)', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Board columns' });
    expect(screen.getByTestId('current-project')).toHaveTextContent('p1');
    await userEvent.click(screen.getByRole('tab', { name: /^Tasks/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Board columns' })).toBeNull());
    expect(where()).toBe('/projects/p1?tab=tasks');
    expect(screen.getByTestId('current-project')).toHaveTextContent('p1');
  });
});
