/** The nightly copy is made from 02:00 company time (a quiet hour in Oman). */
export const NIGHTLY_HOUR = 2;
/** Tries a night before giving up (and telling the administrators). */
export const MAX_NIGHTLY_ATTEMPTS = 3;
/** Time between a failed try and the next. */
export const RETRY_AFTER_MS = 60 * 60 * 1000;

export interface NightlyAttempt {
  status: 'RUNNING' | 'OK' | 'FAILED';
  startedAt: Date;
  finishedAt: Date | null;
}

const hourFormats = new Map<string, Intl.DateTimeFormat>();
function companyHour(now: Date, timeZone: string): number {
  let f = hourFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
    hourFormats.set(timeZone, f);
  }
  return Number(f.format(now));
}

/**
 * Is tonight's copy due? From 02:00 company time, when there is no good nightly copy for today yet,
 * nothing is being made, fewer than three tries were made today, and the last try ended an hour ago.
 * A server that was off at 02:00 makes it as soon as it is back the same day. `today` holds today's
 * nightly tries (company date).
 */
export function nightlyDue(input: { now: Date; timeZone: string; today: NightlyAttempt[]; running: boolean }): boolean {
  const { now, timeZone, today, running } = input;
  if (companyHour(now, timeZone) < NIGHTLY_HOUR) return false;
  if (running || today.some((a) => a.status === 'RUNNING' || a.status === 'OK')) return false;
  if (today.length >= MAX_NIGHTLY_ATTEMPTS) return false;
  const lastEnd = Math.max(0, ...today.map((a) => (a.finishedAt ?? a.startedAt).getTime()));
  return now.getTime() - lastEnd >= RETRY_AFTER_MS;
}
