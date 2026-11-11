import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { workingTimeApi, type WorkingTime } from '../api/working-time';
import { todayKey } from './due-date';
import { useCompanyTimeZone } from './useCompanyTimeZone';
import { dayOffReason, workingDaysLate, type WorkCalendar } from './working-days';

/** One working-time answer per project (or for the page's scope) and range, kept a few minutes. */
export const WORKING_TIME_KEY = ['working-time'] as const;

/** This year and next (the company's day): the range the task form and the dashboards ask for. */
export function defaultWorkingRange(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  return { from: `${year}-01-01`, to: `${year + 1}-12-31` };
}

/** The working days and days off of an answer, as the shared working-day rule reads them. */
export function calendarOf(wt: Pick<WorkingTime, 'workingDays' | 'daysOff'>): WorkCalendar {
  return { workingDays: wt.workingDays, holidays: wt.daysOff.map((d) => ({ day: d.day, name: d.name })) };
}

/**
 * Working days, hours and days off: for a project (its main company's), else the page's scope (the
 * picked company, else the person's own). `from`/`to` default to this year and next.
 */
export function useWorkingTime(opts: { projectId?: string | null; from?: string; to?: string; enabled?: boolean } = {}) {
  const tz = useCompanyTimeZone();
  const range = opts.from && opts.to ? { from: opts.from, to: opts.to } : defaultWorkingRange(todayKey(tz));
  const q = useQuery({
    queryKey: [...WORKING_TIME_KEY, opts.projectId ?? 'scope', range.from, range.to],
    queryFn: () => workingTimeApi(apiClient).get({ projectId: opts.projectId ?? null, ...range }),
    enabled: opts.enabled !== false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const data = q.data && Array.isArray(q.data.workingDays) && Array.isArray(q.data.daysOff) ? q.data : null;
  return { data, calendar: data ? calendarOf(data) : null, isLoading: q.isLoading };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 20 Nov" for a day key (the site's date style). */
export function shortDay(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * The task form's warning for a due date on a day off — never moving it: "Fri 20 Nov is National Day —
 * a day off." / "Sat 14 Nov is a weekend day." Null on a working day (or with no calendar yet).
 */
export function dueDayWarning(dueKey: string | null | undefined, cal: WorkCalendar | null): string | null {
  if (!dueKey || !cal || !/^\d{4}-\d{2}-\d{2}$/.test(dueKey)) return null;
  const why = dayOffReason(dueKey, cal);
  if (!why) return null;
  return why.kind === 'holiday' ? `${shortDay(dueKey)} is ${why.name} — a day off.` : `${shortDay(dueKey)} is a weekend day.`;
}

/** "3 working days" (working days late from the due day to today); calendar days when there is no calendar. */
export function lateWorkingDays(dueKey: string, today: string, cal: WorkCalendar | null): number {
  if (cal) return workingDaysLate(dueKey, today, cal);
  return Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dueKey}T12:00:00Z`)) / 86_400_000));
}
