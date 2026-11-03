import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { companiesApi, MY_COMPANIES_KEY, type MyCompanies, type MyCompany } from '../api/companies';
import { effectiveCompanyId, showCompanyPicker, validPick } from '../lib/companies';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';

export interface MyCompaniesView {
  /** The server's answer (undefined until it arrives). */
  data: MyCompanies | undefined;
  /** My active companies (administrators: every active company), A–Z. */
  companies: MyCompany[];
  /** Two or more companies: the top bar shows the picker. */
  showPicker: boolean;
  /** The picked company's id; null = "All my companies". */
  pick: string | null;
  /** The company whose settings apply: the picked one, else my primary one, else my only one. */
  effective: MyCompany | null;
  /** Active companies on the site (0 until known): company fields show only from 2. */
  siteCompanyCount: number;
}

/**
 * The signed-in person's companies (`GET /me/companies`) and the pick. When the list arrives, the
 * companies' names are remembered (for the notice) and a picked company that is no longer in it —
 * taken away, archived — is cleared with the notice.
 */
export function useMyCompanies(): MyCompaniesView {
  const signedIn = useAuthStore((s) => Boolean(s.isAuthenticated && s.user));
  const pick = useCompanyStore((s) => s.pick);
  const q = useQuery({
    queryKey: MY_COMPANIES_KEY,
    queryFn: () => companiesApi(apiClient).mine(),
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
  const data = q.data;
  const companies = Array.isArray(data?.companies) ? data.companies : [];

  useEffect(() => {
    if (!data || !Array.isArray(data.companies)) return;
    const store = useCompanyStore.getState();
    // First the notice (it names the company from what was known before), then the new names.
    if (store.pick !== null && validPick(store.pick, data.companies) === null) store.companyGone(store.pick);
    // One company left (another one archived, or I was taken out of it): no picker shows the pick, so
    // it must not narrow anything any more — dropped quietly (it is still mine: nothing to say).
    else if (store.pick !== null && !showCompanyPicker(data.companies) && store.userId) store.setPick(store.userId, null);
    store.setNames(Object.fromEntries(data.companies.map((c) => [c.id, c.name])));
  }, [data, pick]);

  const effectiveId = effectiveCompanyId(pick, companies, data?.primaryCompanyId ?? null);
  return {
    data,
    companies,
    showPicker: showCompanyPicker(companies),
    pick,
    effective: companies.find((c) => c.id === effectiveId) ?? null,
    siteCompanyCount: typeof data?.siteCompanyCount === 'number' ? data.siteCompanyCount : 0,
  };
}
