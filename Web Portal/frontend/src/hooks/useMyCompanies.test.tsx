import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useMyCompanies } from './useMyCompanies';
import { useCompanyStore } from '../stores/company-store';
import { useAuthStore } from '../stores/auth-store';
import type { MyCompanies, MyCompany } from '../api/companies';

const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string): MyCompany => ({ id, name, code: id, logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
const a = company('A', 'Alpha Co');
const b = company('B', 'Beta Co');
const myCompanies = (companies: MyCompany[], more: Partial<MyCompanies> = {}): MyCompanies => ({
  companies,
  primaryCompanyId: null,
  allArchived: false,
  siteCompanyCount: companies.length,
  ...more,
});

let asked: string[] = [];
function renderHookWith(answer: MyCompanies) {
  asked = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ data: answer }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useMyCompanies(), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  useCompanyStore.setState({ pick: null, notice: null, names: {}, userId: 'u1' });
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

describe('useMyCompanies', () => {
  it('reads /me/companies and says whether the picker shows', async () => {
    const { result } = renderHookWith(myCompanies([a, b], { primaryCompanyId: 'B' }));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(asked[0]).toMatch(/\/me\/companies$/);
    expect(result.current.companies.map((c) => c.id)).toEqual(['A', 'B']);
    expect(result.current.showPicker).toBe(true);
    expect(result.current.pick).toBeNull();
    expect(result.current.effective?.id).toBe('B');
    expect(result.current.siteCompanyCount).toBe(2);
  });

  it('one company: no picker, and that company is the effective one', async () => {
    const { result } = renderHookWith(myCompanies([a]));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.showPicker).toBe(false);
    expect(result.current.effective?.id).toBe('A');
  });

  it('the picked company is the effective one', async () => {
    useCompanyStore.setState({ pick: 'A' });
    const { result } = renderHookWith(myCompanies([a, b], { primaryCompanyId: 'B' }));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.pick).toBe('A');
    expect(result.current.effective?.id).toBe('A');
  });

  it('remembers the companies’ names for the notice', async () => {
    renderHookWith(myCompanies([a, b]));
    await waitFor(() => expect(useCompanyStore.getState().names).toEqual({ A: 'Alpha Co', B: 'Beta Co' }));
  });

  it('a stored pick the server no longer lists is cleared', async () => {
    useCompanyStore.setState({ pick: 'C' });
    renderHookWith(myCompanies([a, b]));
    await waitFor(() => expect(useCompanyStore.getState().pick).toBeNull());
  });

  it('a company taken away while the page is open is cleared with the notice that names it', async () => {
    useCompanyStore.setState({ pick: 'B', names: { A: 'Alpha Co', B: 'Beta Co' } });
    renderHookWith(myCompanies([a]));
    await waitFor(() => expect(useCompanyStore.getState().pick).toBeNull());
    expect(useCompanyStore.getState().notice).toBe('You no longer have access to Beta Co. Showing all your companies.');
  });

  it('before the answer arrives the pick is left alone and nothing extra shows', () => {
    useCompanyStore.setState({ pick: 'B' });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const qc = new QueryClient();
    const { result } = renderHook(() => useMyCompanies(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    expect(result.current.companies).toEqual([]);
    expect(result.current.showPicker).toBe(false);
    expect(result.current.siteCompanyCount).toBe(0);
    expect(useCompanyStore.getState().pick).toBe('B');
  });
});
