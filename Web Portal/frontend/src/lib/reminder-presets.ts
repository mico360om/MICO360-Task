/**
 * "Remind me" on a task (calendar scheduling, owner 3): the choices offered before its due day or start,
 * and a reminder in plain words. A date-only day counts from the start of the working day (the server
 * works the time out: modules/calendar/task-reminders.ts).
 */
import type { ReminderTiming } from '../api/scheduling';
import { zonedClock, zonedInstant } from './working-days';

export interface ReminderChoice {
  key: string;
  label: string;
  timing: ReminderTiming;
}

const isTimed = (iso: string | null | undefined) => {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0);
};

const DAY = 1440;

/** "1 day before it’s due", "On the morning it starts", "1 h 30 min before it’s due". */
export function offsetWords(anchor: 'start' | 'due', minutes: number, timed: boolean): string {
  const what = anchor === 'due' ? 'it’s due' : 'it starts';
  if (minutes === 0) return timed ? `When ${what}` : `On the morning ${what}`;
  let amount: string;
  if (minutes % (7 * DAY) === 0) amount = minutes === 7 * DAY ? '1 week' : `${minutes / (7 * DAY)} weeks`;
  else if (minutes % DAY === 0) amount = minutes === DAY ? '1 day' : `${minutes / DAY} days`;
  else if (minutes % 60 === 0) amount = minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  else if (minutes > 60) amount = `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  else amount = `${minutes} minutes`;
  return `${amount} before ${what}`;
}

/** The choices for a task: before its due day (or due time), and before its start. */
export function reminderChoices(task: { startDate: string | null; dueDate: string | null }, timeZone: string): ReminderChoice[] {
  void timeZone;
  const out: ReminderChoice[] = [];
  const add = (anchor: 'start' | 'due', minutes: number, timed: boolean) =>
    out.push({ key: `${anchor}-${minutes}`, label: offsetWords(anchor, minutes, timed), timing: { anchor, offsetMinutes: minutes } });
  if (task.dueDate) {
    if (isTimed(task.dueDate)) for (const m of [15, 60, 120, DAY]) add('due', m, true);
    else for (const m of [0, DAY, 2 * DAY, 7 * DAY]) add('due', m, false);
  }
  if (task.startDate) {
    const timed = isTimed(task.startDate);
    for (const m of [0, DAY]) add('start', m, timed);
  }
  return out;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu 19 Nov, 08:00" — an instant in the calendar's zone. */
export function whenText(iso: string, timeZone: string): string {
  const { day, minutes } = zonedClock(new Date(iso), timeZone);
  const d = new Date(`${day}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** A reminder in words: "1 day before it’s due · Thu 19 Nov, 08:00", or its set time. */
export function describeReminder(
  r: { at: string | null; anchor: 'start' | 'due' | null; offsetMinutes: number | null; fireAt: string | null },
  timeZone: string,
  anchorTimed: boolean,
): string {
  if (r.at) return whenText(r.at, timeZone);
  const words = r.anchor ? offsetWords(r.anchor, r.offsetMinutes ?? 0, anchorTimed) : 'Reminder';
  return r.fireAt ? `${words} · ${whenText(r.fireAt, timeZone)}` : words;
}

/** A datetime-local value ('YYYY-MM-DDTHH:MM'), read in the calendar's zone, as an instant (null: not a time). */
export function localInputToIso(value: string, timeZone: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!m) return null;
  return zonedInstant(m[1]!, m[2]!, timeZone).toISOString();
}
