/**
 * Per-date board helpers (web). A "date key" is 'YYYY-MM-DD'. Board days are anchored to the
 * company time zone so the web, mobile, extension and backend all agree on which day it is.
 */

/** 'YYYY-MM-DD' for an instant, in the given IANA time zone. */
export function dateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Shift a date key by N days (noon-UTC math sidesteps DST edges). */
export function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Human label for a date key, e.g. "Wed, 9 Sep 2026". */
export function formatKeyLabel(key: string): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/** A short relative hint for a date key vs today: "Today", "Yesterday", "Tomorrow", or ''. */
export function relativeKeyHint(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today';
  if (key === shiftKey(todayKey, -1)) return 'Yesterday';
  if (key === shiftKey(todayKey, 1)) return 'Tomorrow';
  return '';
}
