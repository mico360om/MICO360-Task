import { generateOccurrences, withAnchorDay, type RecurrenceRule } from './recurrence';

const UNIT: Record<RecurrenceRule['freq'], string> = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
  QUARTERLY: 'quarter',
  YEARLY: 'year',
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "the 2nd Tuesday": week 1–4, or -1 for the last. */
export const WEEK_OF_MONTH: { week: 1 | 2 | 3 | 4 | -1; label: string }[] = [
  { week: 1, label: '1st' },
  { week: 2, label: '2nd' },
  { week: 3, label: '3rd' },
  { week: 4, label: '4th' },
  { week: -1, label: 'last' },
];

/** A short human-readable description of a recurrence rule (for the task badge). */
export function recurrenceSummary(rule: RecurrenceRule): string {
  const unit = UNIT[rule.freq];
  const every = rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}s`;
  let s = `Repeats ${every}`;

  if (rule.freq === 'WEEKLY' && rule.weekdays && rule.weekdays.length > 0) {
    const days = [...rule.weekdays].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ');
    s += ` on ${days}`;
  } else if (rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') {
    if (rule.nthWeekday) {
      const week = WEEK_OF_MONTH.find((w) => w.week === rule.nthWeekday!.week)?.label ?? '';
      s += ` on the ${week} ${WEEKDAY_NAMES[rule.nthWeekday.day] ?? ''}`;
    } else if (rule.dayOfMonth === 31) {
      // Day 31 is clamped to each month's length, so it is always the month's last day.
      s += ' on the last day';
    } else if (rule.dayOfMonth) {
      s += ` on day ${rule.dayOfMonth}`;
    }
  }

  if (rule.count != null) s += `, ${rule.count} times`;
  if (rule.until) s += `, until ${rule.until.slice(0, 10)}`;
  if (rule.createNext === 'ON_SCHEDULE') s += ' · new copy on each date';
  if (rule.paused) s += ' (paused)';
  return s;
}

/**
 * The next `n` due dates ('YYYY-MM-DD') after `due` under the rule, for a preview while editing —
 * the same dates the server works out (lib/recurrence.ts is shared with it).
 */
export function upcomingDates(due: string, rule: RecurrenceRule, n = 3): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return [];
  const start = new Date(`${due}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return [];
  return generateOccurrences(start, withAnchorDay(rule, start), n + 1)
    .slice(1)
    .map((d) => d.toISOString().slice(0, 10));
}
