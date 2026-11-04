/**
 * The Activity calendar's rules (1.22): which changes a filter takes in, the days a question may
 * cover, and how many changes fell on each calendar day of the site's time zone.
 */
import { z } from 'zod';
import { shiftDayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';

/** The Activity page's filters, as the list applies them: Completed also takes in reopenings and approvals. */
export const ACTIVITY_KINDS = {
  CREATED: ['CREATED'],
  MOVED: ['MOVED'],
  COMPLETED: ['COMPLETED', 'REOPENED', 'APPROVED'],
  ASSIGNED: ['ASSIGNED'],
} as const satisfies Record<string, readonly string[]>;
export type ActivityKind = keyof typeof ACTIVITY_KINDS;

/** The actions a filter takes in; null = every change. */
export function actionsOfKind(kind: ActivityKind | undefined): string[] | null {
  return kind ? [...ACTIVITY_KINDS[kind]] : null;
}

/** The longest run of days one question may cover: a quarter (a month grid is six weeks). */
export const MAX_CALENDAR_DAYS = 92;

const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((k) => {
    const d = new Date(`${k}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === k;
  }, 'Not a real date');
const kind = z.enum(Object.keys(ACTIVITY_KINDS) as [ActivityKind, ...ActivityKind[]]);
const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

/** `?from=&to=`: changes per day over these days (both included). */
export const daysQuery = z
  .object({ from: dayKey, to: dayKey, kind: kind.optional() })
  .refine((q) => q.from <= q.to, { message: '`from` must be on or before `to`', path: ['from'] })
  .refine((q) => spanDays(q.from, q.to) <= MAX_CALENDAR_DAYS, { message: `At most ${MAX_CALENDAR_DAYS} days at a time`, path: ['to'] });

/** `?day=`: that day's changes, newest first; `before` = the last one already shown. */
export const dayQuery = z.object({ day: dayKey, before: z.string().trim().min(1).max(64).optional(), kind: kind.optional() });

/** One day's page of changes. */
export const DAY_PAGE = 100;

/** The instants from the start of `fromDay` to the start of the day after `toDay`, in the zone. */
export function dayBounds(fromDay: string, toDay: string, timeZone: string): { from: Date; to: Date } {
  return { from: zonedStartOfDay(fromDay, timeZone), to: zonedStartOfDay(shiftDayKey(toDay, 1), timeZone) };
}

/** How many changes fell on each day (in the zone), oldest day first; days with none are left out. */
export function countPerDay(times: Date[], timeZone: string): { day: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of times) {
    const day = zonedDayKey(t, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, count]) => ({ day, count }));
}
