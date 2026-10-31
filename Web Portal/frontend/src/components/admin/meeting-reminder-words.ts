/**
 * System Settings → Meeting reminders: the stored value (`meetings.reminders`, as the server's
 * settings schema has it), the words for it and reading the editor back. Each reminder time is
 * minutes before the meeting, from 5 minutes to 7 days, at most five, each "also by email" or not.
 */

export interface ReminderTime {
  minutes: number;
  email: boolean;
}

export interface MeetingReminders {
  enabled: boolean;
  times: ReminderTime[];
}

export const MEETING_REMINDERS_KEY = 'meetings.reminders';
export const MIN_REMINDER_MINUTES = 5;
export const MAX_REMINDER_MINUTES = 7 * 24 * 60;
export const MAX_REMINDER_TIMES = 5;

/** Until an administrator changes them (the server's defaults): 24 hours with email, 12 hours, 15 minutes. */
export const DEFAULT_MEETING_REMINDERS: MeetingReminders = {
  enabled: true,
  times: [
    { minutes: 24 * 60, email: true },
    { minutes: 12 * 60, email: false },
    { minutes: 15, email: false },
  ],
};

export type ReminderUnit = 'minutes' | 'hours' | 'days';
export const REMINDER_UNITS: { value: ReminderUnit; label: string; minutes: number }[] = [
  { value: 'minutes', label: 'minutes', minutes: 1 },
  { value: 'hours', label: 'hours', minutes: 60 },
  { value: 'days', label: 'days', minutes: 24 * 60 },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A time in its largest whole unit — days from two days up, so 24 hours stays "24 hours". */
export function splitMinutes(minutes: number): { amount: number; unit: ReminderUnit } {
  if (minutes % 1440 === 0 && minutes >= 2880) return { amount: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' };
  return { amount: minutes, unit: 'minutes' };
}

/** "15 minutes", "12 hours", "24 hours", "2 days". */
export function durationText(minutes: number): string {
  const { amount, unit } = splitMinutes(minutes);
  return plural(amount, unit.slice(0, -1));
}

/** "On: 24 hours (also by email), 12 hours and 15 minutes before", or "Off". */
export function reminderSummary(r: MeetingReminders): string {
  if (!r.enabled) return 'Off';
  const parts = r.times.map((t) => `${durationText(t.minutes)}${t.email ? ' (also by email)' : ''}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
  return `On: ${list} before`;
}

export function isMeetingReminders(v: unknown): v is MeetingReminders {
  if (!v || typeof v !== 'object') return false;
  const r = v as { enabled?: unknown; times?: unknown };
  return (
    typeof r.enabled === 'boolean' &&
    Array.isArray(r.times) &&
    r.times.every((t) => !!t && typeof t === 'object' && Number.isInteger((t as ReminderTime).minutes) && typeof (t as ReminderTime).email === 'boolean')
  );
}

/** One row of the editor: the number as typed, its unit, and the email tick. */
export interface DraftTime {
  amount: string;
  unit: ReminderUnit;
  email: boolean;
}

export function draftOf(r: MeetingReminders): DraftTime[] {
  return r.times.map((t) => {
    const { amount, unit } = splitMinutes(t.minutes);
    return { amount: String(amount), unit, email: t.email };
  });
}

/** The edited times as the server stores them (longest first), or what to fix first. */
export function readDraft(rows: DraftTime[]): { ok: true; times: ReminderTime[] } | { ok: false; problem: string } {
  if (rows.length === 0) return { ok: false, problem: 'Add at least one reminder time, or switch meeting reminders off.' };
  if (rows.length > MAX_REMINDER_TIMES) return { ok: false, problem: `Up to ${MAX_REMINDER_TIMES} reminder times.` };
  const times: ReminderTime[] = [];
  for (const row of rows) {
    const text = row.amount.trim();
    if (!/^\d+$/.test(text)) return { ok: false, problem: 'Enter how long before the meeting each reminder goes, as a whole number.' };
    const minutes = Number(text) * (REMINDER_UNITS.find((u) => u.value === row.unit)?.minutes ?? 1);
    if (minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES) {
      return { ok: false, problem: 'Each reminder has to be between 5 minutes and 7 days before the meeting.' };
    }
    if (times.some((t) => t.minutes === minutes)) return { ok: false, problem: 'Two reminders are at the same time. Change or remove one.' };
    times.push({ minutes, email: row.email });
  }
  return { ok: true, times: times.sort((a, b) => b.minutes - a.minutes) };
}
