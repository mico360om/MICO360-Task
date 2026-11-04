import { dayText } from './day-words';
import { zonedDayKey } from './due-date';

/**
 * 1.23 Meeting series: a meeting's day as the series line and lists write it — "3 Nov", or
 * "3 Nov 2026" when it isn't this year (in the company zone).
 */
export function seriesDay(iso: string, timeZone: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const key = zonedDayKey(d, timeZone);
  return dayText(key, { year: key.slice(0, 4) !== zonedDayKey(now, timeZone).slice(0, 4) });
}

/** The meetings of a series split at now: earlier ones (held, or under way) and the ones still to come. */
export function splitByNow<T extends { startAt: string }>(meetings: readonly T[], now: Date = new Date()): { earlier: T[]; upcoming: T[] } {
  const at = now.getTime();
  return {
    earlier: meetings.filter((m) => Date.parse(m.startAt) < at),
    upcoming: meetings.filter((m) => Date.parse(m.startAt) >= at),
  };
}

/** The page of a series. */
export const seriesHref = (seriesId: string) => `/meetings/series/${encodeURIComponent(seriesId)}`;
