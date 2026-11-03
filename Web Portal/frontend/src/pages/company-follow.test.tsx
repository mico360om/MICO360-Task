import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';
import { bindQueryCacheToCompanyPick } from '../lib/company-scope';
import type { MyCompanies, MyCompany } from '../api/companies';

/**
 * Companies: every page follows the company picked in the top bar. The API client sends the pick
 * with every request (X-Company-Id), and changing it drops what was read for the old one, so the
 * pages on screen read again — with the new company. Site-wide things (the site's settings, the
 * version, my own date settings) are not read again.
 */
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }) }));

const API = 'http://localhost:4000/api/v1';
const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string): MyCompany => ({ id, name, code: id.toUpperCase(), logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
const alpha = company('c-alpha', 'Alpha Co');
const beta = company('c-beta', 'Beta Co');
const MINE: MyCompanies = { companies: [alpha, beta], primaryCompanyId: alpha.id, allArchived: false, siteCompanyCount: 2 };
const project = (id: string, name: string, companyId: string) => ({
  id, code: id.toUpperCase(), name, description: null, clientName: null, status: 'ACTIVE', priority: 'NORMAL', color: '#3A6EA5', imageUrl: null, ownerId: null, startDate: null, targetDate: null, createdAt: '', updatedAt: '',
  companies: [{ id: companyId, name: companyId === alpha.id ? 'Alpha Co' : 'Beta Co', code: 'X', logoUrl: null, isMain: true, timeZone: 'Asia/Muscat', weekStart: 0 }], mainCompanyId: companyId, archived: false,
});
const PA = project('pa', 'Alpha Plant', alpha.id);
const PB = project('pb', 'Beta Yard', beta.id);

type Call = { url: string; method: string; headers: Record<string, string> };
let calls: Call[] = [];
const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

/** The server: answers by URL, and only the picked company's projects while one is picked. */
function answer(url: string, headers: Record<string, string>): Response {
  const path = url.startsWith(API) ? url.slice(API.length).split('?')[0]! : url;
  const pick = headers['X-Company-Id'];
  const projects = pick === beta.id ? [PB] : pick === alpha.id ? [PA] : [PA, PB];
  if (path === '/config') return json({ timeZone: 'Asia/Muscat', productName: 'MICO360 Tasks', companyName: 'Prolens', serverTime: new Date().toISOString(), weekStart: 0 });
  if (path === '/me/companies') return json(MINE);
  if (path === '/projects') return json(projects);
  if (path.startsWith('/projects/') && !path.includes('/', '/projects/'.length)) return json(projects.find((p) => path.endsWith(p.id)) ?? PA);
  if (path === '/notifications/unread-count') return json({ count: 0 });
  if (path === '/users/me/preferences') return json({ timeZone: null, weekStart: null });
  if (path === '/version') return json({ version: '1.20.0', deployedAt: null });
  if (path === '/management/access') return json({ allowed: false, scope: 'none' });
  if (path === '/calendar') return json({ from: '', to: '', timeZone: 'Asia/Muscat', tasks: [], occurrences: [], series: [] });
  return json([]);
}

let qc: QueryClient;
let unbind: () => void = () => {};
function renderApp(path: string) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  unbind = bindQueryCacheToCompanyPick(qc);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
/**
 * Wait until the page is on screen (a lazy page's code loads first: until then the whole app is the
 * "Loading…" fallback) and has stopped asking (no new request for 200 ms).
 */
async function settle() {
  const tick = () => act(() => new Promise((r) => setTimeout(r, 50)));
  for (let i = 0; i < 200 && !document.querySelector('[data-app-header]'); i++) await tick();
  let seen = -1;
  for (let i = 0; i < 100 && seen !== calls.length; i++) {
    seen = calls.length;
    for (let j = 0; j < 4; j++) await tick();
  }
}
const pick = (id: string | null) => act(() => useCompanyStore.getState().setPick('u1', id));
const apiCalls = (list: Call[]) => list.filter((c) => c.url.startsWith(API));
const pathOf = (c: Call) => c.url.slice(API.length);
/** Read once for the whole site (kept across a change of company). */
const SITE_WIDE = /^\/(config|me\/companies|version|users\/me\/preferences)(\?|$)/;

beforeEach(() => {
  calls = [];
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  useCompanyStore.setState({ pick: null, notice: null, noticeName: null, names: {}, userId: 'u1' });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
    calls.push({ url, method: init?.method ?? 'GET', headers });
    return answer(url, headers);
  }));
});
afterEach(() => {
  unbind();
  vi.unstubAllGlobals();
  useCompanyStore.setState({ pick: null, notice: null, noticeName: null, names: {}, userId: null });
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

describe('pages follow the picked company', { timeout: 30_000 }, () => {
  for (const page of ['/dashboard', '/my-tasks', '/projects', '/calendar', '/meetings', '/board']) {
    it(`${page} asks again with the new company after a switch, and only with it`, async () => {
      const { unmount } = renderApp(page);
      await settle();
      const before = apiCalls(calls).filter((c) => c.method === 'GET' && !SITE_WIDE.test(pathOf(c)));
      expect(before.length, page).toBeGreaterThan(0);
      expect(before.every((c) => c.headers['X-Company-Id'] === undefined)).toBe(true);
      const mark = calls.length;
      await pick(beta.id);
      await settle();
      const after = apiCalls(calls.slice(mark));
      expect(after.map(pathOf), page).toEqual(expect.arrayContaining([...new Set(before.map(pathOf))]));
      expect(after.every((c) => c.headers['X-Company-Id'] === beta.id), page).toBe(true);
      unmount();
    });
  }

  it('site-wide things are not read again: the site’s settings, my companies, the version, my own date settings', async () => {
    renderApp('/dashboard');
    await settle();
    const mark = calls.length;
    await pick(beta.id);
    await settle();
    const again = calls.slice(mark).map((c) => (c.url.startsWith(API) ? pathOf(c) : c.url));
    expect(again.filter((u) => SITE_WIDE.test(u))).toEqual([]);
    expect(again.filter((u) => u.includes('build-info.json'))).toEqual([]);
    expect(again.length).toBeGreaterThan(0);
  });

  it('the board falls back to the picked company’s first project when the remembered one is another company’s', async () => {
    localStorage.setItem('mico360.u.u1.board.projectId', 'pb');
    await pick(alpha.id);
    renderApp('/board');
    await settle();
    expect(calls.some((c) => c.url.includes('/projects/pa/columns'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/projects/pb/'))).toBe(false);
    // The remembered one is kept: with Beta picked again, the board is Beta's yard again.
    expect(localStorage.getItem('mico360.u.u1.board.projectId')).toBe('pb');
  });

  it('New task on a page of another company’s project starts in one of the picked company’s projects', async () => {
    await pick(alpha.id);
    renderApp('/projects/pb');
    await settle();
    await userEvent.click(within(document.querySelector('[data-app-header]') as HTMLElement).getByRole('button', { name: /new task/i }));
    const dialog = await screen.findByRole('dialog');
    await settle();
    expect(within(dialog).queryByText('Beta Yard')).toBeNull();
    expect(within(dialog).getByText('Alpha Plant')).toBeInTheDocument();
  });
});
