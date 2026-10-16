import type { RecurrenceRule } from './recurrence';
import { recurrenceSummary } from './recurrence-summary';
import { zonedDayKey } from './due-date';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-03' → '3 Nov 2026'. */
const dayText = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/**
 * "Repeats every week on Tue, until 3 Nov 2026" for a meeting series starting at `startAt`. A
 * weekly rule without chosen days repeats on the first meeting's weekday, where it is held.
 */
export function meetingRepeatText(rule: RecurrenceRule, startAt: string, timeZone: string): string {
  const day = zonedDayKey(new Date(startAt), timeZone);
  const weekdays = rule.freq === 'WEEKLY' && !rule.weekdays?.length ? [new Date(`${day}T12:00:00Z`).getUTCDay()] : rule.weekdays;
  let text = recurrenceSummary({ ...rule, weekdays, count: null, until: null, paused: false, createNext: undefined });
  if (rule.count != null) text += `, ${rule.count} times`;
  if (rule.until) text += `, until ${dayText(rule.until.slice(0, 10))}`;
  return text;
}

/** What's wrong with a meeting's repeat for its first day ('YYYY-MM-DD'), or null. */
export function repeatProblem(rule: RecurrenceRule | null, firstDay: string): string | null {
  if (!rule) return null;
  if (rule.until && firstDay && rule.until.slice(0, 10) < firstDay) return 'The repeat can’t end before the first meeting.';
  return null;
}
