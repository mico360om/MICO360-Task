import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCompanyWeekStart, useDateSettings } from './useDatePrefs';
import { useCompanyTimeZone } from './useCompanyTimeZone';
import { useCompanyStore } from '../stores/company-store';
import { useAuthStore } from '../stores/auth-store';
import { MY_COMPANIES_KEY, type MyCompanies, type MyCompany } from '../api/companies';
import type { ApiProject } from '../api/projects';

/**
 * Amendment 1 (owner, 31 Oct): every company uses the site's time zone. Each company has its own
 * week start: the pages follow the picked company's, else the primary company's, else the site's;
 * a project's own views follow its main company's. A person's own choice still overrides.
 */
const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string, weekStart: 0 | 1 | 6): MyCompany => ({ id, name, code: id, logoUrl: null, timeZone: 'Asia/Muscat', weekStart, workingHours: hours });
const alpha = company('A', 'Alpha Co', 0);
const beta = company('B', 'Beta Co', 1);
const configTz = 'Asia/Muscat';
const configWeekStart = 6;
const prolensSite = company('P', 'Prolens Projects LLC', configWeekStart); // inherits the site's week start

let ownWeek: 0 | 1 | 6 | null = null;
let qc: QueryClient;
function withMyCompanies(more: Partial<MyCompanies>) {
  qc.setQueryData(MY_COMPANIES_KEY, { companies: [], primaryCompanyId: null, allArchived: false, siteCompanyCount: more.companies?.length ?? 0, ...more });
}
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const hook = <T,>(fn: () => T) => renderHook(fn, { wrapper });
const pick = (id: string | null) => act(() => useCompanyStore.getState().setPick('u1', id));
const cacheProject = (p: Partial<ApiProject> & { id: string }) => qc.setQueryData(['project', p.id], { code: 'P', name: 'P', status: 'ACTIVE', ...p });

beforeEach(() => {
  ownWeek = null;
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  useCompanyStore.setState({ pick: null, notice: null, noticeName: null, names: {}, userId: 'u1' });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['app-config'], { timeZone: configTz, productName: '', companyName: '', serverTime: '', weekStart: configWeekStart });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const data = String(url).endsWith('/users/me/preferences') ? { timeZone: null, weekStart: ownWeek } : null;
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  qc.clear();
});

describe('useCompanyWeekStart', () => {
  it('the pages follow the picked company’s week, else the primary one’s', () => {
    withMyCompanies({ companies: [alpha, beta], primaryCompanyId: beta.id });
    const { result } = hook(() => useCompanyWeekStart());
    expect(result.current).toBe(1);
    pick(alpha.id);
    expect(result.current).toBe(0);
    pick(null);
    expect(result.current).toBe(1);
  });

  it('a project’s own views use its main company’s week, whatever is picked', () => {
    withMyCompanies({ companies: [alpha, beta], primaryCompanyId: alpha.id });
    cacheProject({ id: 'P1', companies: [{ id: 'B', name: 'Beta Co', code: 'B', logoUrl: null, isMain: true, timeZone: configTz, weekStart: 1 }, { id: 'A', name: 'Alpha Co', code: 'A', logoUrl: null, isMain: false, timeZone: configTz, weekStart: 0 }], mainCompanyId: 'B' });
    pick(alpha.id);
    expect(hook(() => useCompanyWeekStart({ projectId: 'P1' })).result.current).toBe(1);
  });

  it('a project whose companies aren’t known (an older server) uses the effective company’s', () => {
    withMyCompanies({ companies: [alpha, beta], primaryCompanyId: beta.id });
    cacheProject({ id: 'P2' });
    expect(hook(() => useCompanyWeekStart({ projectId: 'P2' })).result.current).toBe(1);
  });

  it('a company the page names (a meeting without a project) uses that company’s week', () => {
    withMyCompanies({ companies: [alpha, beta], primaryCompanyId: alpha.id });
    expect(hook(() => useCompanyWeekStart({ companyId: 'B' })).result.current).toBe(1);
    expect(hook(() => useCompanyWeekStart({ companyId: 'gone' })).result.current).toBe(0);
  });

  it('one company inheriting the site: exactly /config’s time zone and week start', () => {
    withMyCompanies({ companies: [prolensSite] });
    expect(hook(() => useCompanyTimeZone()).result.current).toBe(configTz);
    expect(hook(() => useCompanyWeekStart()).result.current).toBe(configWeekStart);
  });

  it('before my companies are known, and for an administrator with none: the site’s week', () => {
    expect(hook(() => useCompanyWeekStart()).result.current).toBe(configWeekStart);
    withMyCompanies({ companies: [alpha, beta] }); // no primary, nothing picked
    expect(hook(() => useCompanyWeekStart()).result.current).toBe(configWeekStart);
  });

  it('the time zone never follows the pick: every company uses the site’s', () => {
    withMyCompanies({ companies: [alpha, { ...beta, timeZone: 'Europe/London' }], primaryCompanyId: beta.id });
    const { result } = hook(() => useCompanyTimeZone());
    pick(beta.id);
    expect(result.current).toBe(configTz);
  });
});

describe('useDateSettings follows the company too', () => {
  it('the company’s week is the picked one’s; a person’s own choice still wins', async () => {
    withMyCompanies({ companies: [alpha, beta], primaryCompanyId: alpha.id });
    pick(beta.id);
    const { result } = hook(() => useDateSettings());
    expect(result.current.companyWeekStart).toBe(1);
    expect(result.current.weekStart).toBe(1);
    // They choose their own (the first answer, without one, has arrived).
    await waitFor(() => expect(qc.getQueryState(['date-prefs'])?.status).toBe('success'));
    ownWeek = 6;
    await act(() => qc.invalidateQueries({ queryKey: ['date-prefs'] }));
    await waitFor(() => expect(result.current.weekStart).toBe(6));
    expect(result.current.companyWeekStart).toBe(1);
    expect(result.current.timeZone).toBe(configTz);
  });
});
