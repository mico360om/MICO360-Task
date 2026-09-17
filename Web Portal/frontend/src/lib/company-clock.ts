import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { configApi } from '../api/config';

const FALLBACK_TZ = 'Asia/Muscat';

export interface CompanyClock {
  /** e.g. "08 Aug 2026" */
  date: string;
  /** e.g. "11:55 PM" */
  time: string;
  /** e.g. "08 Aug 2026 | 11:55 PM" */
  full: string;
}

/**
 * Format an absolute instant in a specific IANA time zone — 12-hour with AM/PM.
 * Pure + deterministic (given the same instant + zone), so it's fully testable.
 * Falls back to UTC if the zone is invalid.
 */
export function formatCompanyClock(instantMs: number, timeZone: string): CompanyClock {
  const d = new Date(instantMs);
  const fmt = (tz: string) => {
    // Build "DD Mon YYYY" from parts so months are always the 3-letter en-US form
    // (e.g. "Sep", not en-GB's "Sept") in a fixed day-first order.
    const dp = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(d);
    const part = (type: string) => dp.find((p) => p.type === type)?.value ?? '';
    const date = `${part('day')} ${part('month')} ${part('year')}`;
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
    return { date, time };
  };
  let parts: { date: string; time: string };
  try {
    parts = fmt(timeZone);
  } catch {
    parts = fmt('UTC');
  }
  return { ...parts, full: `${parts.date} | ${parts.time}` };
}

/**
 * Live company clock for the header. Reads the company time zone + server time
 * from the public `/config` endpoint (works for every role), anchors to the
 * server clock (not the device clock), and ticks every second.
 */
export function useCompanyClock(): CompanyClock & { timeZone: string; ready: boolean } {
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => configApi(apiClient).get(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const timeZone = data?.timeZone ?? FALLBACK_TZ;

  // Offset (server − device) so the clock shows company/server time even if the device clock is wrong.
  const offsetRef = useRef(0);
  useEffect(() => {
    if (!data?.serverTime) return;
    const serverMs = Date.parse(data.serverTime);
    if (!Number.isNaN(serverMs)) offsetRef.current = serverMs - Date.now();
  }, [data?.serverTime]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return { ...formatCompanyClock(nowMs + offsetRef.current, timeZone), timeZone, ready: Boolean(data) };
}
