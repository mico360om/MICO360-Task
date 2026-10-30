import { dayText } from './day-words';

/**
 * Per-date board helpers (mobile) — mirror the web + backend so all platforms agree on
 * "which day" a task belongs to. A date key is 'YYYY-MM-DD', anchored to the company time zone.
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

/** Human label for a date key, day before month as the website's top bar writes it: "Wed 9 Sep 2026". */
export function formatKeyLabel(key: string): string {
  return dayText(key, { weekday: 'short' });
}

/** "Today" | "Yesterday" | "Tomorrow" | '' for a key relative to today's key. */
export function relativeKeyHint(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today';
  if (key === shiftKey(todayKey, -1)) return 'Yesterday';
  if (key === shiftKey(todayKey, 1)) return 'Tomorrow';
  return '';
}
