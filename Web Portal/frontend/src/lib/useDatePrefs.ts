import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';
import { preferencesApi, type DatePreferences } from '../api/preferences';
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

/** Your date settings (Settings → Calendar), falling back to the company's time zone and week start (Sunday until set). */
export function useDateSettings(): DateSettings {
  const companyTimeZone = useCompanyTimeZone();
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const { data } = useQuery({ queryKey: DATE_PREFS_KEY, queryFn: () => preferencesApi(apiClient).get(), staleTime: 5 * 60_000 });
  const prefs = (data ?? null) as DatePreferences | null;
  const own = prefs?.timeZone && isValidTimeZone(prefs.timeZone) ? prefs.timeZone : null;
  const companyWeekStart: WeekStart = isWeekStart(configQ.data?.weekStart) ? configQ.data.weekStart : 0;
  const ownWeekStart: WeekStart | null = isWeekStart(prefs?.weekStart) ? prefs.weekStart : null;
  return { timeZone: own ?? companyTimeZone, companyTimeZone, ownTimeZone: own, weekStart: ownWeekStart ?? companyWeekStart, ownWeekStart, companyWeekStart };
}
