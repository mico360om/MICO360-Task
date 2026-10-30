import { nextOccurrence, type RecurrenceRule } from './recurrence';

/**
 * Scheduled inspections on the website: the schedule dialog's defaults (its name, the repeat
 * presets, the first check's day) and the words the Inspections tab uses ("2 days late").
 * A schedule always makes its checks on schedule (`createNext: 'ON_SCHEDULE'`), done or not.
 */

export type SchedulePreset = 'DAILY' | 'WORKING_DAYS' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export const SCHEDULE_PRESETS: Array<{ value: SchedulePreset; label: string }> = [
  { value: 'DAILY', label: 'Every day' },
  { value: 'WORKING_DAYS', label: 'Every working day' },
  { value: 'WEEKLY', label: 'Weekly on…' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'CUSTOM', label: 'Custom' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NTH: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last' };

const atNoon = (key: string) => new Date(`${key}T12:00:00.000Z`);
const asDay = (key: string) => new Date(`${key}T00:00:00.000Z`);
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const shift = (key: string, days: number) => {
  const d = atNoon(key);
  d.setUTCDate(d.getUTCDate() + days);
  return keyOf(d);
};
const sameDays = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** "Wed 28 Oct": a calendar day, never shifted into another zone. */
export function shortDay(key: string): string {
  const d = atNoon(key);
  return Number.isNaN(d.getTime()) ? key : `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The name a schedule gets until the person types their own: "<form> – <place>", or the form. */
export function defaultScheduleName(formTitle: string, place: string): string {
  const form = formTitle.trim();
  if (!form) return '';
  return place.trim() ? `${form} – ${place.trim()}` : form;
}

/** A preset's repeat, starting on `startsOn` ('YYYY-MM-DD'); every working day uses the company's working days. */
export function presetRule(preset: Exclude<SchedulePreset, 'CUSTOM'>, startsOn: string, workingDays: number[]): RecurrenceRule {
  const base = { interval: 1, createNext: 'ON_SCHEDULE' as const };
  switch (preset) {
    case 'DAILY':
      return { freq: 'DAILY', ...base };
    case 'WORKING_DAYS':
      return { freq: 'WEEKLY', interval: 1, weekdays: [...workingDays].sort((a, b) => a - b), createNext: 'ON_SCHEDULE' };
    case 'WEEKLY':
      return { freq: 'WEEKLY', interval: 1, weekdays: [atNoon(startsOn).getUTCDay()], createNext: 'ON_SCHEDULE' };
    case 'MONTHLY':
      return { freq: 'MONTHLY', interval: 1, dayOfMonth: atNoon(startsOn).getUTCDate(), createNext: 'ON_SCHEDULE' };
  }
}

/** Which preset a repeat is (an edit opens on it); anything the presets don't make is custom. */
export function presetOf(rule: RecurrenceRule, workingDays: number[]): SchedulePreset {
  if (rule.interval !== 1) return 'CUSTOM';
  if (rule.freq === 'DAILY') return 'DAILY';
  if (rule.freq === 'WEEKLY' && rule.weekdays?.length) return sameDays(rule.weekdays, workingDays) ? 'WORKING_DAYS' : 'WEEKLY';
  if (rule.freq === 'MONTHLY' && !rule.nthWeekday) return 'MONTHLY';
  return 'CUSTOM';
}

/** The first check's due day: the start day when the schedule falls on it, else the first one after it. */
export function firstCheckDay(startsOn: string, rule: RecurrenceRule): string {
  if (rule.freq === 'WEEKLY' && rule.weekdays?.length) {
    const days = new Set(rule.weekdays);
    for (let i = 0; i < 7; i++) if (days.has(atNoon(shift(startsOn, i)).getUTCDay())) return shift(startsOn, i);
    return startsOn;
  }
  if (rule.freq === 'MONTHLY' && (rule.dayOfMonth || rule.nthWeekday)) {
    return keyOf(nextOccurrence(asDay(shift(startsOn, -1)), { ...rule, interval: 1 }));
  }
  return startsOn;
}

const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** "every working day", "every 2 weeks on Monday", "on the last day of every month". */
function howOften(rule: RecurrenceRule, workingDays: number[]): string {
  const n = rule.interval;
  const every = (unit: string) => (n === 1 ? `every ${unit}` : `every ${n} ${unit}s`);
  switch (rule.freq) {
    case 'DAILY':
      return every('day');
    case 'WEEKLY': {
      const days = [...(rule.weekdays ?? [])].sort((a, b) => a - b);
      if (n === 1 && days.length && sameDays(days, workingDays)) return 'every working day';
      if (!days.length) return every('week');
      const names = listNames(days.map((d) => WEEKDAYS[d]!));
      return n === 1 ? `every ${names}` : `every ${n} weeks on ${names}`;
    }
    case 'MONTHLY':
    case 'QUARTERLY': {
      const months = rule.freq === 'QUARTERLY' ? 3 * n : n;
      const span = months === 1 ? 'every month' : `every ${months} months`;
      if (rule.nthWeekday) return `on the ${NTH[String(rule.nthWeekday.week)]} ${WEEKDAYS[rule.nthWeekday.day]} of ${span}`;
      if (rule.dayOfMonth === 31) return `on the last day of ${span}`;
      if (rule.dayOfMonth) return `on day ${rule.dayOfMonth} of ${span}`;
      return span;
    }
    case 'YEARLY':
      return every('year');
  }
}

/**
 * What the schedule will do, in plain words, under Repeat: "A check is created every working day,
 * due that day, for Ali and Sara. The first one is due on Wed 28 Oct." (`firstDay` null on an edit).
 */
export function scheduleSentence(rule: RecurrenceRule, inspectors: string[], workingDays: number[], firstDay: string | null): string {
  let when = howOften(rule, workingDays);
  if (rule.count != null) when += `, ${rule.count} ${rule.count === 1 ? 'time' : 'times'}`;
  if (rule.until) when += `, until ${shortDay(rule.until.slice(0, 10))}`;
  const who = inspectors.length ? `, for ${listNames(inspectors)}.` : '. Pick at least one inspector.';
  const first = inspectors.length && firstDay ? ` The first one is due on ${shortDay(firstDay)}.` : '';
  return `A check is created ${when}, due that day${who}${first}`;
}

/** "2 days late". */
export const lateText = (days: number) => `${days} ${days === 1 ? 'day' : 'days'} late`;

/** "Due today", "Due tomorrow", "Due Mon 2 Nov" (`today` is the company's 'YYYY-MM-DD'). */
export function dueText(dueDate: string | null, today: string): string {
  if (!dueDate) return 'No due date';
  if (dueDate === today) return 'Due today';
  if (dueDate === shift(today, 1)) return 'Due tomorrow';
  return `Due ${shortDay(dueDate)}`;
}

/** An upcoming check (not due yet): "Tomorrow", "Mon 2 Nov", or "No due date". */
export function upcomingText(dueDate: string | null, today: string): string {
  if (!dueDate) return 'No due date';
  return dueDate === shift(today, 1) ? 'Tomorrow' : shortDay(dueDate);
}
