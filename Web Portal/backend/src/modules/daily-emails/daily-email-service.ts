import { shiftDayKey, zonedStartOfDay } from '../../lib/due-date';
import type { EmailContent } from '../email/email-templates';
import { dailyEmailPrefs, type NotificationPreferences } from '../notifications/notification-preferences';
import { completedEmail, pendingEmail, type DailyTask } from './daily-email-content';
import type { DailyEmailKind, DailyEmailRecord, DailyEmailRepository } from './daily-email-repository';

/** Someone who may get the morning emails (active accounts only). */
export interface DailyRecipient {
  id: string;
  name: string;
  email: string | null;
  /** Their own time zone, else null (the company's is used). */
  timeZone: string | null;
  prefs: NotificationPreferences;
  createdAt: Date;
}

export interface DailyEmailServiceDeps {
  repo: DailyEmailRepository;
  people: { list(): Promise<DailyRecipient[]>; find(id: string): Promise<DailyRecipient | null> };
  /** Read fresh at send time; only ever the person's own tasks (assigned to them). */
  tasks: {
    pending(userId: string): Promise<DailyTask[]>;
    completedBetween(userId: string, from: Date, to: Date): Promise<DailyTask[]>;
  };
  /** Sends one email; throws when it can't be delivered. */
  send(to: string, content: EmailContent, template: string): Promise<void>;
  /** False while no email provider is set up: nothing is attempted (and nothing piles up). */
  isConfigured(): boolean;
  companyTimeZone: string;
  appUrl: string;
  now?: () => Date;
  logger?: { info(msg: string, ctx?: Record<string, unknown>): void; warn(msg: string, ctx?: Record<string, unknown>): void };
}

/** A failed send is tried again after 5, 15 and 45 minutes; the fourth failure is final. */
export const RETRY_DELAYS_MIN = [5, 15, 45];
const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
/** A send still "SENDING" after this long was cut off (a restart mid-send) and is tried again. */
const STUCK_AFTER_MS = 15 * 60 * 1000;
const KINDS: DailyEmailKind[] = ['PENDING', 'COMPLETED'];
const TEMPLATE: Record<DailyEmailKind, string> = { PENDING: 'daily-pending', COMPLETED: 'daily-completed' };

function validZone(tz: string | null, fallback: string): string {
  if (!tz) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

/** The calendar day and minute of the day at `now` in a time zone. */
function localClock(now: Date, timeZone: string): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The two morning task emails. Every minute the sweep sends whatever is due: each person's emails once
 * their time (06:00 unless they chose another, in their own time zone) has come that day — so a server
 * that was asleep catches up later the same day. One record per person, day and email makes sure each
 * goes out once; it is also the delivery log. A failed send is retried (5, 15, 45 minutes), then failed.
 * An email with nothing in it isn't sent.
 */
export function createDailyEmailService(deps: DailyEmailServiceDeps) {
  const now = deps.now ?? (() => new Date());
  let warnedNotConfigured = false;

  async function build(kind: DailyEmailKind, person: DailyRecipient, day: string, at: Date): Promise<{ count: number; content: EmailContent | null }> {
    const timeZone = validZone(person.timeZone, deps.companyTimeZone);
    if (kind === 'PENDING') {
      const tasks = await deps.tasks.pending(person.id);
      return { count: tasks.length, content: tasks.length ? pendingEmail({ name: person.name, tasks, timeZone, now: at, appUrl: deps.appUrl }) : null };
    }
    const yesterday = shiftDayKey(day, -1);
    const tasks = await deps.tasks.completedBetween(person.id, zonedStartOfDay(yesterday, timeZone), zonedStartOfDay(day, timeZone));
    return { count: tasks.length, content: tasks.length ? completedEmail({ name: person.name, tasks, day: yesterday, timeZone, appUrl: deps.appUrl }) : null };
  }

  async function attempt(row: DailyEmailRecord, person: DailyRecipient): Promise<DailyEmailRecord['status']> {
    const at = now();
    try {
      const prefs = dailyEmailPrefs(person.prefs);
      if (!person.email || !(row.kind === 'PENDING' ? prefs.pending : prefs.completed)) {
        // Turned off (or no address) since it was due: nothing to send.
        await deps.repo.finish(row.id, { status: 'SKIPPED', taskCount: 0, nextAttemptAt: null });
        return 'SKIPPED';
      }
      const { count, content } = await build(row.kind, person, row.day, at);
      if (!content) {
        await deps.repo.finish(row.id, { status: 'SKIPPED', taskCount: 0, nextAttemptAt: null });
        return 'SKIPPED';
      }
      await deps.send(person.email, content, TEMPLATE[row.kind]);
      await deps.repo.finish(row.id, { status: 'SENT', taskCount: count, sentAt: at, nextAttemptAt: null, lastError: null });
      return 'SENT';
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (row.attempts >= MAX_ATTEMPTS) {
        await deps.repo.finish(row.id, { status: 'FAILED', lastError: error, nextAttemptAt: null });
        deps.logger?.warn('daily task email failed for good', { userId: row.userId, kind: row.kind, day: row.day, error });
        return 'FAILED';
      }
      const delay = RETRY_DELAYS_MIN[row.attempts - 1]!;
      await deps.repo.finish(row.id, { status: 'RETRY', lastError: error, nextAttemptAt: new Date(at.getTime() + delay * 60_000) });
      return 'RETRY';
    }
  }

  async function runSweep(): Promise<Record<'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED', number>> {
    const tally = { SENT: 0, SKIPPED: 0, RETRY: 0, FAILED: 0 };
    const count = (s: DailyEmailRecord['status']) => {
      if (s !== 'SENDING') tally[s]++;
    };
    if (!deps.isConfigured()) {
      if (!warnedNotConfigured) deps.logger?.warn('Daily task emails are waiting: email sending is not set up on this server');
      warnedNotConfigured = true;
      return tally;
    }
    warnedNotConfigured = false;
    const at = now();

    for (const person of await deps.people.list()) {
      if (!person.email) continue;
      const timeZone = validZone(person.timeZone, deps.companyTimeZone);
      const prefs = dailyEmailPrefs(person.prefs);
      const { day, minutes } = localClock(at, timeZone);
      const due = toMinutes(prefs.time);
      if (minutes < due) continue;
      // Someone who joined after today's time starts the morning after.
      if (person.createdAt.getTime() > zonedStartOfDay(day, timeZone).getTime() + due * 60_000) continue;
      for (const kind of KINDS) {
        if (!(kind === 'PENDING' ? prefs.pending : prefs.completed)) continue;
        const row = await deps.repo.claim(person.id, day, kind);
        if (row) count(await attempt(row, person));
      }
    }

    for (const due of await deps.repo.dueForRetry(at, new Date(at.getTime() - STUCK_AFTER_MS))) {
      const taken = await deps.repo.retake(due);
      if (!taken) continue;
      const person = await deps.people.find(taken.userId);
      if (!person) {
        await deps.repo.finish(taken.id, { status: 'SKIPPED', taskCount: 0, lastError: 'The account is no longer active.' });
        count('SKIPPED');
        continue;
      }
      count(await attempt(taken, person));
    }
    if (tally.SENT || tally.RETRY || tally.FAILED) deps.logger?.info('daily task emails', tally);
    return tally;
  }

  /** Both emails to the person now, whatever their settings — not counted as today's. */
  async function sendTest(userId: string): Promise<{ pending: 'sent' | 'empty'; completed: 'sent' | 'empty' }> {
    const person = await deps.people.find(userId);
    if (!person?.email) throw new Error('Your account has no email address.');
    const at = now();
    const { day } = localClock(at, validZone(person.timeZone, deps.companyTimeZone));
    const result = { pending: 'empty' as 'sent' | 'empty', completed: 'empty' as 'sent' | 'empty' };
    for (const kind of KINDS) {
      const { content } = await build(kind, person, day, at);
      if (!content) continue;
      await deps.send(person.email, content, `${TEMPLATE[kind]}-test`);
      result[kind === 'PENDING' ? 'pending' : 'completed'] = 'sent';
    }
    return result;
  }

  return { runSweep, sendTest };
}

export type DailyEmailService = ReturnType<typeof createDailyEmailService>;
