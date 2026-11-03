import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { preferencesApi, type DatePreferences } from '../api/preferences';
import { projectsApi } from '../api/projects';
import { useMyCompanies } from '../hooks/useMyCompanies';
import { isValidTimeZone, useCompanyTimeZone } from './useCompanyTimeZone';
import type { WeekStart } from './calendar';

export const DATE_PREFS_KEY = ['date-prefs'] as const;

export interface DateSettings {
  /** The zone dates are shown in: your own if you chose one, else the company's. */
  timeZone: string;
  companyTimeZone: string;
  /** Your own choice (null = the company's). */
  ownTimeZone: string | null;
  /** The week start in force: your own if you chose one, else the company's. */
  weekStart: WeekStart;
  /** Your own choice (null = the company's). */
  ownWeekStart: WeekStart | null;
  /** The company's (an administrator sets it; Sunday until then). */
  companyWeekStart: WeekStart;
}

const isWeekStart = (v: unknown): v is WeekStart => v === 0 || v === 1 || v === 6;

/**
 * The company's week start (an administrator sets it; Sunday until then). Companies: each company has
 * its own (the site's until one is set) — the picked company's, else my primary company's, else my
 * only one's, else the site's (/config). `{ projectId }`: a project's own views use its main
 * company's (from the project's `['project', id]`); `{ companyId }`: that one of my companies (a
 * meeting without a project). The time zone is the site's for every company (owner, 31 Oct).
 */
export function useCompanyWeekStart(opts: { projectId?: string | null; companyId?: string | null } = {}): WeekStart {
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const { companies, effective } = useMyCompanies();
  const projectId = opts.projectId || null;
  const projectQ = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi(apiClient).get(projectId!), enabled: !!projectId, staleTime: 30_000 });
  const site: WeekStart = isWeekStart(configQ.data?.weekStart) ? configQ.data.weekStart : 0;
  if (projectId) {
    const own = projectQ.data?.companies;
    const main = Array.isArray(own) ? (own.find((c) => c.isMain) ?? own[0]) : undefined;
    if (main && isWeekStart(main.weekStart)) return main.weekStart;
  }
  const named = opts.companyId ? companies.find((c) => c.id === opts.companyId) : undefined;
  const company = named ?? effective;
  return company && isWeekStart(company.weekStart) ? company.weekStart : site;
}

/** Your date settings (Settings → Calendar), falling back to the company's time zone and week start (Sunday until set). */
export function useDateSettings(): DateSettings {
  const companyTimeZone = useCompanyTimeZone();
  // Companies: the picked company's week (else my primary one's, else the site's).
  const companyWeekStart = useCompanyWeekStart();
  const { data } = useQuery({ queryKey: DATE_PREFS_KEY, queryFn: () => preferencesApi(apiClient).get(), staleTime: 5 * 60_000 });
  const prefs = (data ?? null) as DatePreferences | null;
  const own = prefs?.timeZone && isValidTimeZone(prefs.timeZone) ? prefs.timeZone : null;
  const ownWeekStart: WeekStart | null = isWeekStart(prefs?.weekStart) ? prefs.weekStart : null;
  return { timeZone: own ?? companyTimeZone, companyTimeZone, ownTimeZone: own, weekStart: ownWeekStart ?? companyWeekStart, ownWeekStart, companyWeekStart };
}
