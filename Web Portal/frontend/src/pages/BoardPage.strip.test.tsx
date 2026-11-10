import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { BoardTab } from '../components/project-dashboard/BoardTab';
import { useAuthStore } from '../stores/auth-store';
import { userStorageKey } from '../lib/user-storage';
import { shiftDayKey, todayKey } from '../lib/due-date';
import type { ApiProject } from '../api/projects';
import { TOUCH_SQUARE } from '../lib/touch';

// The Kanban board's project strip (owner, 10 Nov): one slim line of the chosen project's basics above the columns.
vi.mock('../lib/useBoardRealtime', () => ({ useBoardRealtime: () => {} }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const TODAY = todayKey('UTC');
const project = (id: string, code: string, name: string, more: Record<string, unknown> = {}) => ({
  id, code, name, number: null, description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', icon: null, imageUrl: null, ownerId: 'u9', startDate: null, targetDate: null, createdAt: '', updatedAt: '', ...more,
});
const PROJECTS = [
  project('p1', 'MICO', 'MICO360 Platform', { number: 'J-204', clientName: 'OXY Oman', startDate: shiftDayKey(TODAY, -30), targetDate: shiftDayKey(TODAY, 20) }),
  project('p2', 'OPS', 'Operations'),
];
const HEALTH = {
  projectId: 'p1',
  rag: 'AMBER',
  reasons: [{ code: 'LATE_TASKS', level: 'AMBER', text: '3 late tasks' }],
  completion: { mode: 'WEIGHT', pct: 63, countPct: 50, weightPct: 63, total: 24, done: 12, weightTotal: 40, weightDone: 25 },
  timeUsedPct: 60,
  risks: [],
  owners: { owner: { id: 'u9', name: 'Olivia Owner', avatarUrl: null }, managers: [{ id: 'u7', name: 'Bilal Khan', avatarUrl: null }], milestones: [] },
  counts: { open: 12, overdue: 3 },
  generatedAt: new Date().toISOString(),
};
let healthStatus = 200;
let healthCalls = 0;

beforeEach(() => {
  healthStatus = 200;
  healthCalls = 0;
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'p1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/config')) return json({ data: { timeZone: 'UTC', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      if (/\/projects\/p\d\/health$/.test(u)) {
        healthCalls += 1;
        return healthStatus === 200 ? json({ data: HEALTH }) : json({ error: { code: 'INTERNAL', message: 'x' } }, healthStatus);
      }
      if (u.includes('/columns')) return json({ data: [{ id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '', enabled: true }] });
      if (u.includes('/members')) return json({ data: [] });
      if (u.includes('/tasks?')) return json({ data: [] });
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function renderPage(ui: React.ReactNode = <BoardPage />) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/board']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
/** A phone-sized window (below the `sm` width): only the queries that ask for at least 40em fail. */
function phone() {
  const mm = vi.fn((q: string) => ({ matches: !/min-width/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
  Object.defineProperty(window, 'matchMedia', { value: mm, configurable: true, writable: true });
}
const strip = () => screen.findByRole('region', { name: 'Project details' });

describe('Kanban board: the project strip', () => {
  it('one project chosen: its picture, name and number, client, project manager, dates and days left, health, progress, open and overdue, and Open project', async () => {
    renderPage();
    const s = await strip();
    expect(within(s).getByText('MICO360 Platform')).toBeInTheDocument();
    expect(within(s).getByText('MICO')).toBeInTheDocument();
    expect(s).toHaveTextContent('No. J-204');
    expect(within(s).getByTitle('Client: OXY Oman')).toBeInTheDocument();
    expect(await within(s).findByTitle('Project manager: Bilal Khan')).toBeInTheDocument();
    expect(s).toHaveTextContent('20 days left');
    expect(within(s).getByRole('button', { name: /Amber/ })).toHaveAttribute('data-health-badge');
    expect(within(s).getByRole('progressbar', { name: 'Progress, by weight' })).toHaveAttribute('aria-valuenow', '63');
    expect(s).toHaveTextContent('63%');
    expect(s).toHaveTextContent('12 open');
    expect(s).toHaveTextContent('3 overdue');
    expect(within(s).getByRole('link', { name: 'Open project' })).toHaveAttribute('href', '/projects/p1');
  });

  it('All projects shows nothing extra', async () => {
    localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'all');
    renderPage();
    await screen.findByRole('region', { name: 'Board columns' });
    expect(screen.queryByRole('region', { name: 'Project details' })).toBeNull();
    expect(healthCalls).toBe(0);
  });

  it('a project page’s Board tab has the project’s own header, so no strip there', async () => {
    renderPage(<BoardTab project={PROJECTS[0] as unknown as ApiProject} />);
    await screen.findByRole('region', { name: 'Board columns' });
    expect(screen.queryByRole('region', { name: 'Project details' })).toBeNull();
  });

  it('folds away to its picture, name, health and progress, and stays folded (remembered for the person)', async () => {
    const user = userEvent.setup();
    const first = renderPage();
    const s = await strip();
    await within(s).findByTitle('Project manager: Bilal Khan');
    await user.click(within(s).getByRole('button', { name: 'Project details', expanded: true }));
    const folded = await strip();
    expect(within(folded).getByText('MICO360 Platform')).toBeInTheDocument();
    expect(within(folded).getByRole('button', { name: /Amber/ })).toBeInTheDocument();
    expect(folded).toHaveTextContent('63%');
    expect(within(folded).queryByTitle('Client: OXY Oman')).toBeNull();
    expect(within(folded).getByRole('button', { name: 'Project details', expanded: false })).toBeInTheDocument();
    first.unmount();
    renderPage();
    const again = await strip();
    expect(within(again).getByRole('button', { name: 'Project details', expanded: false })).toBeInTheDocument();
    await user.click(within(again).getByRole('button', { name: 'Project details' }));
    expect(within(await strip()).getByTitle('Client: OXY Oman')).toBeInTheDocument();
  });

  it('review I2: folding and opening keeps the keyboard on the button (it is the same button)', async () => {
    const user = userEvent.setup();
    renderPage();
    const s = await strip();
    await within(s).findByTitle('Project manager: Bilal Khan');
    within(s).getByRole('button', { name: 'Project details' }).focus();
    await user.keyboard('{Enter}');
    const folded = await strip();
    expect(within(folded).getByRole('button', { name: 'Project details', expanded: false })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(within(await strip()).getByRole('button', { name: 'Project details', expanded: true })).toHaveFocus();
  });

  it('review: its arrow is a 44px square on a touch screen (not only 44px tall)', async () => {
    renderPage();
    const s = await strip();
    expect(within(s).getByRole('button', { name: 'Project details' }).className).toContain(TOUCH_SQUARE);
  });

  it('on a phone: the short version, with Details to open the rest', async () => {
    phone();
    const user = userEvent.setup();
    renderPage();
    const s = await strip();
    await waitFor(() => expect(s).toHaveTextContent('63%'));
    expect(within(s).queryByTitle('Client: OXY Oman')).toBeNull();
    const details = within(s).getByRole('button', { name: 'Project details', expanded: false });
    expect(details).toHaveTextContent('Details');
    await user.click(details);
    expect(within(await strip()).getByTitle('Client: OXY Oman')).toBeInTheDocument();
    expect(within(await strip()).getByRole('button', { name: 'Project details', expanded: true })).toHaveFocus();
  });

  it('without its health (an older server, or it failed), the project’s own details still show', async () => {
    healthStatus = 500;
    renderPage();
    const s = await strip();
    expect(within(s).getByText('MICO360 Platform')).toBeInTheDocument();
    expect(s).toHaveTextContent('20 days left');
    await waitFor(() => expect(healthCalls).toBeGreaterThan(0));
    expect(within(s).queryByRole('progressbar')).toBeNull();
    expect(within(s).getByRole('link', { name: 'Open project' })).toBeInTheDocument();
  });
});
