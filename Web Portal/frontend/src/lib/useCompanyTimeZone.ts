import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';

/** Used until /config answers (and if it ever returns something unusable). */
export const DEFAULT_COMPANY_TIME_ZONE = 'Asia/Muscat';

/** True when the runtime recognises `tz` as an IANA time zone. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The company time zone from the public `/config` endpoint. Shares the `app-config` cache entry
 * with the header clock, so it costs no extra request once the shell has loaded.
 */
export function useCompanyTimeZone(): string {
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => configApi(apiClient).get(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const tz = (data as { timeZone?: unknown } | undefined)?.timeZone;
  return isValidTimeZone(tz) ? tz : DEFAULT_COMPANY_TIME_ZONE;
}
