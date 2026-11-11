/**
 * KPIs: working time between two instants — the minutes inside working hours on working days (the
 * company's calendar and hours, in the site's time zone). Approval turnaround and update responsiveness
 * count working hours (design), so an approval asked for on Thursday evening and given on Sunday morning
 * took an hour, not two days. Built on the Notification & Scheduling working-day helper; a long span is
 * counted from whole working days, never by walking every minute.
 */
import { isWorkingDay, minutesOf, workingDaysBetween, zonedClock, type WorkCalendar, type WorkHours } from '../../lib/working-days';

/** Working minutes from `from` to `to` (0 when `to` is not later). */
export function workingMinutesBetween(from: Date, to: Date, timeZone: string, cal: WorkCalendar, hours: WorkHours): number {
  if (!(to.getTime() > from.getTime()) || cal.workingDays.length === 0) return 0;
  const start = minutesOf(hours.start);
  const end = minutesOf(hours.end);
  if (end <= start) return 0;
  const a = zonedClock(from, timeZone);
  const b = zonedClock(to, timeZone);
  const overlap = (lo: number, hi: number) => Math.max(0, Math.min(hi, end) - Math.max(lo, start));
  if (a.day === b.day) return isWorkingDay(a.day, cal) ? overlap(a.minutes, b.minutes) : 0;
  const first = isWorkingDay(a.day, cal) ? overlap(a.minutes, 24 * 60) : 0;
  const last = isWorkingDay(b.day, cal) ? overlap(0, b.minutes) : 0;
  // Working days strictly between the two days: those after the first up to the last, less the last itself.
  const between = workingDaysBetween(a.day, b.day, cal) - (isWorkingDay(b.day, cal) ? 1 : 0);
  return first + last + Math.max(0, between) * (end - start);
}

/** Working hours from `from` to `to`. */
export function workingHoursBetween(from: Date, to: Date, timeZone: string, cal: WorkCalendar, hours: WorkHours): number {
  return workingMinutesBetween(from, to, timeZone, cal, hours) / 60;
}

/** The middle value (the mean of the two middle ones for an even count); null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
