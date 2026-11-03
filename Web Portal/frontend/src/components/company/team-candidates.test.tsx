import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useTeamCandidates } from './team-candidates';
import { useAuthStore } from '../../stores/auth-store';
import { useCompanyStore } from '../../stores/company-store';
import type { MyCompany } from '../../api/companies';

const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string): MyCompany => ({ id, name, code: id, logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
const alpha = company('cA', 'Alpha Co');
const beta = company('cB', 'Beta Co');

let asked: string[];
let mine: { companies: MyCompany[]; siteCompanyCount: number };
beforeEach(() => {
  asked = [];
  useCompanyStore.setState({ pick: null, notice: null, names: {}, userId: 'u1' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    asked.push(u);
    if (u.endsWith('/me/companies')) return new Response(JSON.stringify({ data: { ...mine, primaryCompanyId: null, allArchived: false } }), { status: 200 });
    if (u.includes('/people/candidates')) return new Response(JSON.stringify({ data: [{ id: 'amy', firstName: 'Amy', lastName: 'A', username: 'amy', avatarUrl: null }] }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function hook(companyIds: string[] | null, admin = false, opts: { projectId?: string | null } = {}) {
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: admin ? ['ADMIN'] : [] }, accessToken: 'at', refreshToken: 'rt' });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useTeamCandidates(companyIds, opts), { wrapper });
}
const candidateAsks = () => asked.filter((u) => u.includes('/people/candidates')).map((u) => u.slice(u.indexOf('/people/')));

describe('useTeamCandidates', () => {
  it('one company on the site: nothing to ask — the directory is used as before', async () => {
    mine = { companies: [alpha], siteCompanyCount: 1 };
    const { result } = hook([alpha.id]);
    await waitFor(() => expect(asked.some((u) => u.endsWith('/me/companies'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
    expect(candidateAsks()).toEqual([]);
  });

  it('two or more: the people of the project’s companies', async () => {
    mine = { companies: [alpha, beta], siteCompanyCount: 2 };
    const { result } = hook([alpha.id, beta.id]);
    await waitFor(() => expect(result.current?.map((p) => p.id)).toEqual(['amy']));
    expect(candidateAsks()).toEqual([`/people/candidates?companyIds=${alpha.id},${beta.id}`]);
  });

  it('someone not an administrator asks only about their own companies (the server refuses others)', async () => {
    mine = { companies: [beta], siteCompanyCount: 2 };
    const { result } = hook([alpha.id, beta.id]);
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(candidateAsks()).toEqual([`/people/candidates?companyIds=${beta.id}`]);
  });

  it('an administrator asks about every company of the project', async () => {
    mine = { companies: [beta], siteCompanyCount: 2 };
    const { result } = hook([alpha.id, beta.id], true);
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(candidateAsks()).toEqual([`/people/candidates?companyIds=${alpha.id},${beta.id}`]);
  });

  it('none of mine: nobody to offer, and nothing asked', async () => {
    mine = { companies: [beta], siteCompanyCount: 2 };
    const { result } = hook([alpha.id]);
    await waitFor(() => expect(result.current).toEqual([]));
    expect(candidateAsks()).toEqual([]);
  });
});

describe('useTeamCandidates for a project that exists', () => {
  it('its own team asks the project: people of ANY of its companies, mine or not (owner, 31 Oct)', async () => {
    mine = { companies: [beta], siteCompanyCount: 2 };
    const { result } = hook([alpha.id, beta.id], false, { projectId: 'p1' });
    await waitFor(() => expect(result.current?.map((p) => p.id)).toEqual(['amy']));
    expect(candidateAsks()).toEqual(['/people/candidates?projectId=p1']);
  });

  it('one company on the site: still nothing to ask', async () => {
    mine = { companies: [alpha], siteCompanyCount: 1 };
    const { result } = hook([alpha.id], false, { projectId: 'p1' });
    await waitFor(() => expect(asked.some((u) => u.endsWith('/me/companies'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
    expect(candidateAsks()).toEqual([]);
  });
});
