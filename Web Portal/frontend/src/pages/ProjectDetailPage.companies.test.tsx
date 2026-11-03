import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProjectDetailPage } from './ProjectDetailPage';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';

/** The Team tab on a site with companies (MC2 Task 6): new members come from the project's companies. */

const fakeSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string) => ({ id, name, code: id, logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
const alpha = company('cA', 'Alpha Co');
const beta = company('cB', 'Beta Co');
const PROJECT = {
  id: 'p1', code: 'PAB', name: 'Shared project', description: null, clientName: null, status: 'ACTIVE', priority: 'NORMAL', color: '#8B1E1E', ownerId: 'u1', canManage: true, createdAt: '', updatedAt: '',
  companies: [{ ...alpha, isMain: true }, { ...beta, isMain: false }], mainCompanyId: alpha.id,
};

let calls: string[];
let site: number;
beforeEach(() => {
  calls = [];
  site = 2;
  useCompanyStore.setState({ pick: null, notice: null, names: {}, userId: 'u1' });
  // A Beta manager of a shared Alpha + Beta project (not an administrator).
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@b.c', username: 'mona', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push(method === 'GET' ? u.slice(u.indexOf('/', 8)) : `${method} ${u}`);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
    if (u.endsWith('/me/companies')) return json({ data: { companies: site >= 2 ? [beta] : [alpha], primaryCompanyId: null, allArchived: false, siteCompanyCount: site } });
    // Its people: Beta's when asked by companies (only mine), every company's when asked by the project.
    if (u.includes('/people/candidates?projectId=')) return json({ data: [{ id: 'amy', firstName: 'Amy', lastName: 'Alphaonly', username: 'amy', avatarUrl: null }, { id: 'bob', firstName: 'Bob', lastName: 'Betaonly', username: 'bob', avatarUrl: null }] });
    if (u.includes('/people/candidates')) return json({ data: [{ id: 'bob', firstName: 'Bob', lastName: 'Betaonly', username: 'bob', avatarUrl: null }] });
    if (u.includes('/members')) {
      return json({ data: [
        { id: 'u1', username: 'mona', email: '', firstName: 'Mona', lastName: 'M', role: 'MANAGER', hasAccess: true },
        { id: 'ben', username: 'ben', email: '', firstName: 'Ben', lastName: 'Gone', role: 'MEMBER', hasAccess: false },
      ] });
    }
    if (u.endsWith('/users/directory')) return json({ data: [
      { id: 'u1', username: 'mona', firstName: 'Mona', lastName: 'M', avatarUrl: null },
      { id: 'amy', username: 'amy', firstName: 'Amy', lastName: 'Alphaonly', avatarUrl: null, colleague: false },
      { id: 'bob', username: 'bob', firstName: 'Bob', lastName: 'Betaonly', avatarUrl: null },
    ] });
    if (u.includes('/columns')) return json({ data: [] });
    if (u.endsWith('/meetings-overview')) return json({ data: { meetings: [], decisions: [], actionItems: [], series: [], stats: { upcoming: 0, ongoing: 0, completed: 0, cancelled: 0, nextMeetingId: null, openActionItems: 0, overdueActionItems: 0, decisions: 0 } } });
    if (u.includes('/inspections')) return json({ data: { inspections: [], canStart: true } });
    if (u.endsWith('/projects')) return json({ data: [PROJECT] });
    if (u.includes('/tasks')) return json({ data: [] });
    if (u.includes('/client-shares')) return json({ data: [] });
    return json({ data: PROJECT });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderTeam() {
  render(
    <MemoryRouter initialEntries={['/projects/p1?tab=team']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Project page — Team tab with companies', () => {
  it('"Add a member" offers people from ANY of the project’s companies (not only mine), not the whole directory', async () => {
    renderTeam();
    await screen.findByRole('heading', { level: 1, name: 'Shared project' });
    await waitFor(() => expect(calls).toContain('/api/v1/people/candidates?projectId=p1'));
    const picker = await screen.findByLabelText(/add a member/i);
    await waitFor(() => expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select a teammate…', 'Amy Alphaonly', 'Bob Betaonly']));
    expect(calls.some((c) => c.includes('/people/candidates?companyIds='))).toBe(false);
  });

  it('a member who can no longer see the project says so', async () => {
    renderTeam();
    expect(await screen.findByText('No access')).toBeInTheDocument();
    expect(screen.getByText('Ben Gone').closest('li')).toHaveTextContent('No access');
  });

  it('one company: the directory, as before', async () => {
    site = 1;
    renderTeam();
    const picker = await screen.findByLabelText(/add a member/i);
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Amy Alphaonly' })).toBeInTheDocument());
    expect(calls.some((u) => u.includes('/people/candidates'))).toBe(false);
  });
});
