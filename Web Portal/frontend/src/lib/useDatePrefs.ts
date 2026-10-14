import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
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
  weekStart: WeekStart;
}

/** Your date settings (Settings → Calendar), falling back to the company's time zone and Sunday. */
export function useDateSettings(): DateSettings {
  const companyTimeZone = useCompanyTimeZone();
  const { data } = useQuery({ queryKey: DATE_PREFS_KEY, queryFn: () => preferencesApi(apiClient).get(), staleTime: 5 * 60_000 });
  const prefs = (data ?? null) as DatePreferences | null;
  const own = prefs?.timeZone && isValidTimeZone(prefs.timeZone) ? prefs.timeZone : null;
  const weekStart: WeekStart = prefs?.weekStart === 1 || prefs?.weekStart === 6 ? prefs.weekStart : 0;
  return { timeZone: own ?? companyTimeZone, companyTimeZone, ownTimeZone: own, weekStart };
}
