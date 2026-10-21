import { zonedStartOfDay, zonedDayKey } from '../../lib/due-date';
import type { RecurrenceRule } from '../tasks/recurrence';
import type { WorkingHours } from '../settings/settings-service';
import { fallsOnRule, seriesStarts } from './meeting-series';

/** When someone invited is already in another meeting (the title only if the viewer may see it). */
export interface BusyBlock {
  userId: string;
  start: Date;
  end: Date;
  meetingId: string;
  title: string | null;
}

const MIN = 60_000;
/** Suggested times start on these boundaries. */
const STEP_MIN = 30;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const shiftDay = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const overlaps = (block: BusyBlock, start: number, end: number) => block.start.getTime() < end && block.end.getTime() > start;

/**
 * The nearest free times for a meeting of `minutes`, from `from` onward: on working days, inside
 * working hours, starting on 30-minute marks, when no one invited is busy. A repeat keeps its days
 * (a weekly meeting only on its weekdays, a monthly one on its day). Looks `searchDays` days ahead.
 */
export function suggestTimes(input: {
  from: Date;
  minutes: number;
  busy: BusyBlock[];
  hours: WorkingHours;
  timeZone: string;
  rule?: RecurrenceRule | null;
  count?: number;
  searchDays?: number;
}): Date[] {
  const { from, minutes, busy, hours, timeZone, rule } = input;
  const count = input.count ?? 3;
  const firstDay = zonedDayKey(from, timeZone);
  const open = toMinutes(hours.start);
  const close = toMinutes(hours.end);
  const out: Date[] = [];
  for (let d = 0; d < (input.searchDays ?? 14) && out.length < count; d++) {
    const key = shiftDay(firstDay, d);
    const wall = new Date(`${key}T12:00:00Z`);
    if (!hours.days.includes(wall.getUTCDay())) continue;
    if (rule && !fallsOnRule(wall, rule)) continue;
    const midnight = zonedStartOfDay(key, timeZone).getTime();
    // The first mark on or after `from` (on its own day), else the day's opening.
    const sinceMidnight = Math.max(0, Math.ceil((from.getTime() - midnight) / MIN));
    let t = Math.max(open, Math.ceil(sinceMidnight / STEP_MIN) * STEP_MIN);
    for (; t + minutes <= close && out.length < count; t += STEP_MIN) {
      const start = midnight + t * MIN;
      const end = start + minutes * MIN;
      if (!busy.some((b) => overlaps(b, start, end))) out.push(new Date(start));
    }
  }
  return out;
}

/**
 * Who is already busy at the chosen time: for a repeat, at each of its first `occurrences` meetings.
 * Each clash names the person, the meeting's date (company calendar) and the other meeting's time.
 */
export function findClashes(input: {
  start: Date;
  minutes: number;
  busy: BusyBlock[];
  timeZone: string;
  rule?: RecurrenceRule | null;
  occurrences?: number;
}): Array<{ userId: string; date: string; start: Date; end: Date; title: string | null }> {
  const { start, minutes, busy, timeZone, rule } = input;
  const n = input.occurrences ?? 4;
  const starts = rule ? seriesStarts(start, rule, timeZone, new Date(start.getTime() + 5 * 366 * 86_400_000)).slice(0, n) : [start];
  return starts.flatMap((s) => {
    const from = s.getTime();
    const to = from + minutes * MIN;
    const date = zonedDayKey(s, timeZone);
    return busy.filter((b) => overlaps(b, from, to)).map((b) => ({ userId: b.userId, date, start: b.start, end: b.end, title: b.title }));
  });
}
