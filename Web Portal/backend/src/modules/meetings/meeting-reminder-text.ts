import { shiftDayKey, zonedDayKey } from '../../lib/due-date';
import { formatDay, wallClock } from '../../lib/export-format';

/** What a reminder says about its meeting. */
export interface ReminderMeeting {
  title: string;
  startAt: Date;
  endAt: Date | null;
  location: string | null;
  onlineLink: string | null;
}

export interface ReminderWordingInput {
  meeting: ReminderMeeting;
  /** The meeting's own time zone (a valid IANA zone): every time is said in it. */
  meetingZone: string;
  /** The person's own zone (theirs, else the company's); null for an outside guest. */
  personZone: string | null;
  /** How long before the start this reminder is (its System Settings time). */
  offsetMinutes: number;
  now: Date;
}

export interface ReminderWording {
  /** "Meeting in 15 minutes: Core switch go-live review" — the bell's and the phone's headline. */
  title: string;
  /** "09:00–10:00 · OXY HQ – Meeting room 2 · Join online". */
  body: string;
  /** "starts in 15 minutes" / "starts tomorrow at 09:00" — for the email's sentence. */
  startsIn: string;
  /** The email's "When": "Sat 31 Oct 2026, 09:00–10:00 (GMT+4)", and the person's own time when it differs. */
  when: string;
}

/** Reminders a day or more ahead name the day ("tomorrow at 09:00"); nearer ones the time left. */
const DAY_FORM_MINUTES = 24 * 60;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "15 minutes", "1 hour", "1 hour 30 minutes", "12 hours" (minutes past the hour to the nearest 5). */
function timeLeft(minutes: number): string {
  if (minutes < 60) return plural(minutes, 'minute');
  let hours = Math.floor(minutes / 60);
  let rest = Math.round((minutes % 60) / 5) * 5;
  if (rest === 60) {
    hours += 1;
    rest = 0;
  }
  return rest ? `${plural(hours, 'hour')} ${plural(rest, 'minute')}` : plural(hours, 'hour');
}

/** "09:00" — the 24-hour clock in a zone. */
const clock = (d: Date, zone: string) => wallClock(d, zone).slice(11);

/** "09:00–10:00", or "09:00" for a meeting without an end. */
const range = (m: ReminderMeeting, zone: string) => (m.endAt ? `${clock(m.startAt, zone)}–${clock(m.endAt, zone)}` : clock(m.startAt, zone));

/** "GMT+4": the zone's short name at that moment. */
function zoneName(at: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: zone, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

/** The meeting's day from today, both in its zone: 'today', 'tomorrow' or the date ("Sat 31 Oct 2026"). */
function dayOf(start: Date, now: Date, zone: string): { kind: 'today' | 'tomorrow' | 'date'; date: string } {
  const day = zonedDayKey(start, zone);
  const today = zonedDayKey(now, zone);
  if (day === today) return { kind: 'today', date: formatDay(day, { weekday: true }) };
  if (day === shiftDayKey(today, 1)) return { kind: 'tomorrow', date: formatDay(day, { weekday: true }) };
  return { kind: 'date', date: formatDay(day, { weekday: true }) };
}

/**
 * The words of one meeting reminder — the same on the bell, the phone and in the email. Times are
 * the meeting's own (its time zone, 24-hour clock); someone whose clock differs also gets theirs in
 * brackets. A reminder a day or more ahead names the day; a nearer one says how long is left.
 */
export function reminderWording({ meeting, meetingZone, personZone, offsetMinutes, now }: ReminderWordingInput): ReminderWording {
  const start = meeting.startAt;
  const day = dayOf(start, now, meetingZone);
  const startClock = clock(start, meetingZone);

  let headline: string;
  let dayPrefix = '';
  if (offsetMinutes >= DAY_FORM_MINUTES) {
    headline = day.kind === 'date' ? `on ${day.date} at ${startClock}` : `${day.kind} at ${startClock}`;
  } else {
    // Never more than is really left: a reminder sent a little late says less.
    const left = Math.max(1, Math.ceil((start.getTime() - now.getTime()) / 60_000));
    headline = `in ${timeLeft(left)}`;
    if (day.kind === 'tomorrow') dayPrefix = 'Tomorrow, ';
    else if (day.kind === 'date') dayPrefix = `${day.date}, `;
  }

  // Their own clock, when it differs from the meeting's: "05:00–06:00", or with their day when that differs too.
  let theirs: string | null = null;
  if (personZone && personZone !== meetingZone && wallClock(start, personZone) !== wallClock(start, meetingZone)) {
    const theirDay = zonedDayKey(start, personZone);
    theirs = `${theirDay !== zonedDayKey(start, meetingZone) ? `${formatDay(theirDay)}, ` : ''}${range(meeting, personZone)}`;
  }
  const zone = zoneName(start, meetingZone);
  const shortWhen = `${dayPrefix}${range(meeting, meetingZone)}${theirs ? ` ${zone} (${theirs} your time)` : ''}`;
  const parts = [shortWhen, meeting.location?.trim() || null, meeting.onlineLink?.trim() ? 'Join online' : null].filter((p): p is string => !!p);
  const when = `${day.date}, ${range(meeting, meetingZone)} (${zone})${theirs ? ` — ${theirs} your time` : ''}`;

  return { title: `Meeting ${headline}: ${meeting.title}`, body: parts.join(' · '), startsIn: `starts ${headline}`, when };
}
