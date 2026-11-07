import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ProjectDetailPage } from './ProjectDetailPage';
import { useAuthStore } from '../stores/auth-store';
import { userStorageKey } from '../lib/user-storage';
import { CurrentProjectProvider } from '../components/CurrentProject';

// Kanban Board: Monthly View on a project page's Board tab — the same Day | Month, remembered for the tab on its own.
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }) }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const PROJECT = { id: 'p1', code: 'MICO', name: 'MICO Platform', description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', ownerId: null, createdAt: '', updatedAt: '', canManage: true };
const COLUMNS = [{ id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#111', enabled: true }];
const TASK = { id: 't1', key: 'MICO-1', title: 'Pour slab', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: '2026-11-05T00:00:00.000Z', dueDate: '2026-11-20T00:00:00.000Z', progress: 0, completedAt: null, createdAt: '', updatedAt: '' };

let calls: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-07T08:00:00.000Z'));
  calls = [];
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@b.c', username: 'manager', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
    if (u.endsWith('/me/companies')) return json({ data: { companies: [], primaryCompanyId: null, allArchived: false, siteCompanyCount: 1 } });
    if (u.includes('/client-shares')) return json({ data: [] });
    if (u.includes('/members')) return json({ data: [] });
    if (u.endsWith('/users/directory')) return json({ data: [] });
    if (u.includes('/columns')) return json({ data: COLUMNS });
    if (u.endsWith('/meetings-overview')) return json({ data: { meetings: [], decisions: [], actionItems: [], series: [], stats: { upcoming: 0, ongoing: 0, completed: 0, cancelled: 0, nextMeetingId: null, openActionItems: 0, overdueActionItems: 0, decisions: 0 } } });
    if (u.endsWith('/projects/p1/inspections')) return json({ data: { inspections: [], canStart: true } });
    if (u.endsWith('/projects')) return json({ data: [PROJECT] });
    if (u.includes('/tasks')) return json({ data: [TASK] });
    return json({ data: PROJECT });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CurrentProjectProvider>
          <Routes>
            <Route path="/projects/:id" element={<><ProjectDetailPage /><Where /></>} />
          </Routes>
        </CurrentProjectProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent ?? '';

describe('ProjectDetailPage: the Board tab’s month view', () => {
  it('Month on the tab: the month bar, the month in the address, the project’s month asked for', async () => {
    renderPage('/projects/p1?tab=board');
    await userEvent.click(await screen.findByRole('button', { name: 'Month view' }));
    expect(await screen.findByRole('group', { name: 'Month: November 2026' })).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe('/projects/p1?tab=board&month=2026-11'));
    await waitFor(() => expect(calls.some((u) => u.endsWith('/tasks?month=2026-11&undated=true&projectId=p1'))).toBe(true));
    expect(await screen.findByText('5–20 Nov')).toBeInTheDocument();
  });

  it('remembers its own choice, apart from the Kanban Board page’s', async () => {
    const first = renderPage('/projects/p1?tab=board&month=2027-02');
    await screen.findByRole('group', { name: 'Month: February 2027' });
    await waitFor(() => expect(localStorage.getItem(userStorageKey('u1', 'project-board.month'))).toBe('2027-02'));
    expect(localStorage.getItem(userStorageKey('u1', 'project-board.period'))).toBe('month');
    expect(localStorage.getItem(userStorageKey('u1', 'board.period'))).toBeNull();
    first.unmount();
    renderPage('/projects/p1?tab=board');
    expect(await screen.findByRole('group', { name: 'Month: February 2027' })).toBeInTheDocument();
  });
});
