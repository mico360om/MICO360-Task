import { shiftDayKey, zonedStartOfDay } from '../../lib/due-date';
import type { EmailContent } from '../email/email-templates';
import { dailyEmailPrefs, type NotificationPreferences } from '../notifications/notification-preferences';
import { completedEmail, pendingEmail, type DailyTask } from './daily-email-content';
import type { DailyEmailKind, DailyEmailRecord, DailyEmailRepository, DailyEmailStatus } from './daily-email-repository';

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

/**
 * One email's state on a day, for the administrators: OFF (turned off, nothing recorded), DUE (still
 * to come: `dueAt`), NONE (a past day with nothing recorded), else the delivery record's status.
 */
export type DailyEmailState = 'OFF' | 'DUE' | 'NONE' | DailyEmailStatus;

export interface DailyEmailOverviewEmail {
  /** The person's setting now. */
  on: boolean;
  state: DailyEmailState;
  /**
   * DUE: when it goes — that day's time, or tomorrow's for someone who joined after today's. It may
   * have passed while the server hasn't sent it yet (email not set up, or the server was asleep).
   */
  dueAt: Date | null;
  sentAt: Date | null;
  taskCount: number;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
}

export interface DailyEmailOverviewPerson {
  userId: string;
  name: string;
  email: string;
  /** The time zone used: their own, else the company's. */
  timeZone: string;
  ownTimeZone: boolean;
  /** 'HH:MM', in that time zone. */
  time: string;
  /** The person's calendar day shown ('YYYY-MM-DD'). */
  day: string;
  pending: DailyEmailOverviewEmail;
  completed: DailyEmailOverviewEmail;
}

export interface DailyEmailOverview {
  /** The day asked for, or null: each person's own today. */
  day: string | null;
  /** When the sweep last ran on this server; null when it hasn't since the server started. */
  lastCheckedAt: Date | null;
  /** The next time any person's email is due (it may have passed: due now). */
  nextSendAt: Date | null;
  summary: {
    /** People who get at least one email (an address, at least one turned on). */
    people: number;
    sent: number;
    skipped: number;
    failed: number;
    retrying: number;
    sending: number;
    /** Still to come. */
    upcoming: number;
    /** People "Send today's emails now" would send to (it is always about today). */
    toSend: number;
  };
  people: DailyEmailOverviewPerson[];
}

/** How an administrator's send of one email went. */
export type ManualSendOutcome = 'sent' | 'empty' | 'retry' | 'failed' | 'already-sent' | 'already-done' | 'busy' | 'off';
export interface ManualSendResult {
  kind: DailyEmailKind;
  outcome: ManualSendOutcome;
  /** Why it couldn't be sent (retry, failed). */
  error: string | null;
  /** When it went: now (sent), or the earlier send (already-sent, or a resend that failed). */
  sentAt: Date | null;
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
/** The instant someone's emails are due on a day (their time, in their time zone). */
const dueOn = (day: string, timeZone: string, time: string) => new Date(zonedStartOfDay(day, timeZone).getTime() + toMinutes(time) * 60_000);
const isOn = (prefs: ReturnType<typeof dailyEmailPrefs>, kind: DailyEmailKind) => (kind === 'PENDING' ? prefs.pending : prefs.completed);

/**
 * The two morning task emails. Every minute the sweep sends whatever is due: each person's emails once
 * their time (06:00 unless they chose another, in their own time zone) has come that day — so a server
 * that was asleep catches up later the same day. One record per person, day and email makes sure each
 * goes out once; it is also the delivery log. A failed send is retried (5, 15, 45 minutes), then failed.
 * An email with nothing in it isn't sent.
 *
 * Administrators can send today's emails at once (everyone's, or one person's) through the same
 * records, so a manual send counts as today's and the sweep never sends it a second time.
 */
export function createDailyEmailService(deps: DailyEmailServiceDeps) {
  const now = deps.now ?? (() => new Date());
  let warnedNotConfigured = false;
  let lastChecked: Date | null = null;
  const zoneOf = (person: DailyRecipient) => validZone(person.timeZone, deps.companyTimeZone);

  async function build(kind: DailyEmailKind, person: DailyRecipient, day: string, at: Date): Promise<{ count: number; content: EmailContent | null }> {
    const timeZone = zoneOf(person);
    if (kind === 'PENDING') {
      const tasks = await deps.tasks.pending(person.id);
      return { count: tasks.length, content: tasks.length ? pendingEmail({ name: person.name, tasks, timeZone, now: at, appUrl: deps.appUrl }) : null };
    }
    const yesterday = shiftDayKey(day, -1);
    const tasks = await deps.tasks.completedBetween(person.id, zonedStartOfDay(yesterday, timeZone), zonedStartOfDay(day, timeZone));
    return { count: tasks.length, content: tasks.length ? completedEmail({ name: person.name, tasks, day: yesterday, timeZone, appUrl: deps.appUrl }) : null };
  }

  interface Attempted {
    status: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';
    error: string | null;
    sentAt: Date | null;
  }

  /**
   * Sends a taken (SENDING) row and records how it went. `again`: a resend of an email that already
   * went — it stays counted as sent whatever happens (a failure is noted, never retried by the sweep).
   */
  async function attempt(row: DailyEmailRecord, person: DailyRecipient, again = false): Promise<Attempted> {
    const at = now();
    const keepSent = async (error: string | null): Promise<Attempted> => {
      await deps.repo.finish(row.id, { status: 'SENT', nextAttemptAt: null, ...(error ? { lastError: error } : {}) });
      return { status: error ? 'FAILED' : 'SKIPPED', error, sentAt: row.sentAt };
    };
    try {
      if (!person.email || !isOn(dailyEmailPrefs(person.prefs), row.kind)) {
        // Turned off (or no address) since it was due: nothing to send.
        if (again) return await keepSent(null);
        await deps.repo.finish(row.id, { status: 'SKIPPED', taskCount: 0, nextAttemptAt: null });
        return { status: 'SKIPPED', error: null, sentAt: null };
      }
      const { count, content } = await build(row.kind, person, row.day, at);
      if (!content) {
        if (again) return await keepSent(null);
        await deps.repo.finish(row.id, { status: 'SKIPPED', taskCount: 0, nextAttemptAt: null });
        return { status: 'SKIPPED', error: null, sentAt: null };
      }
      await deps.send(person.email, content, TEMPLATE[row.kind]);
      await deps.repo.finish(row.id, { status: 'SENT', taskCount: count, sentAt: at, nextAttemptAt: null, lastError: null });
      return { status: 'SENT', error: null, sentAt: at };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (again) return keepSent(error);
      if (row.attempts >= MAX_ATTEMPTS) {
        await deps.repo.finish(row.id, { status: 'FAILED', lastError: error, nextAttemptAt: null });
        deps.logger?.warn('daily task email failed for good', { userId: row.userId, kind: row.kind, day: row.day, error });
        return { status: 'FAILED', error, sentAt: null };
      }
      const delay = RETRY_DELAYS_MIN[row.attempts - 1]!;
      await deps.repo.finish(row.id, { status: 'RETRY', lastError: error, nextAttemptAt: new Date(at.getTime() + delay * 60_000) });
      return { status: 'RETRY', error, sentAt: null };
    }
  }

  async function runSweep(): Promise<Record<'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED', number>> {
    const tally = { SENT: 0, SKIPPED: 0, RETRY: 0, FAILED: 0 };
    const count = (s: Attempted['status']) => {
      tally[s]++;
    };
    const at = now();
    if (!deps.isConfigured()) {
      if (!warnedNotConfigured) deps.logger?.warn('Daily task emails are waiting: email sending is not set up on this server');
      warnedNotConfigured = true;
      lastChecked = at;
      return tally;
    }
    warnedNotConfigured = false;

    for (const person of await deps.people.list()) {
      if (!person.email) continue;
      const timeZone = zoneOf(person);
      const prefs = dailyEmailPrefs(person.prefs);
      const { day, minutes } = localClock(at, timeZone);
      if (minutes < toMinutes(prefs.time)) continue;
      // Someone who joined after today's time starts the morning after.
      if (person.createdAt.getTime() > dueOn(day, timeZone, prefs.time).getTime()) continue;
      for (const kind of KINDS) {
        if (!isOn(prefs, kind)) continue;
        const row = await deps.repo.claim(person.id, day, kind);
        if (row) count((await attempt(row, person)).status);
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
      count((await attempt(taken, person)).status);
    }
    lastChecked = at;
    if (tally.SENT || tally.RETRY || tally.FAILED) deps.logger?.info('daily task emails', tally);
    return tally;
  }

  /** Both emails to the person now, whatever their settings — not counted as today's. */
  async function sendTest(userId: string): Promise<{ pending: 'sent' | 'empty'; completed: 'sent' | 'empty' }> {
    const person = await deps.people.find(userId);
    if (!person?.email) throw new Error('Your account has no email address.');
    const at = now();
    const { day } = localClock(at, zoneOf(person));
    const result = { pending: 'empty' as 'sent' | 'empty', completed: 'empty' as 'sent' | 'empty' };
    for (const kind of KINDS) {
      const { content } = await build(kind, person, day, at);
      if (!content) continue;
      await deps.send(person.email, content, `${TEMPLATE[kind]}-test`);
      result[kind === 'PENDING' ? 'pending' : 'completed'] = 'sent';
    }
    return result;
  }

  const OUTCOME: Record<Attempted['status'], ManualSendOutcome> = { SENT: 'sent', SKIPPED: 'empty', RETRY: 'retry', FAILED: 'failed' };

  /**
   * An administrator's send of one person's email for `day` (their today), through the same record as
   * the sweep: a new one is claimed; a failed or retrying one is taken again; a skipped one too when
   * `retrySkipped`; a sent one only for a `resend`. One being sent right now is left alone. Never an
   * email the person turned off.
   */
  async function sendOne(person: DailyRecipient, day: string, kind: DailyEmailKind, opts: { resend: boolean; retrySkipped: boolean }): Promise<ManualSendResult> {
    const result = (outcome: ManualSendOutcome, error: string | null = null, sentAt: Date | null = null): ManualSendResult => ({ kind, outcome, error, sentAt });
    if (!isOn(dailyEmailPrefs(person.prefs), kind)) return result('off');
    let row = await deps.repo.claim(person.id, day, kind);
    let again = false;
    if (!row) {
      const existing = await deps.repo.find(person.id, day, kind);
      if (!existing || existing.status === 'SENDING') return result('busy');
      if (existing.status === 'SENT' && !opts.resend) return result('already-sent', null, existing.sentAt);
      if (existing.status === 'SKIPPED' && !opts.retrySkipped) return result('already-done');
      again = existing.status === 'SENT';
      row = await deps.repo.retake(existing);
      if (!row) return result('busy'); // someone else took it a moment ago
    }
    const done = await attempt(row, person, again);
    return result(OUTCOME[done.status], done.error, done.sentAt);
  }

  /**
   * "Send today's emails now": everyone's emails for their today, at once, whatever the time — each one
   * turned on that hasn't gone yet (none, failed or waiting for a retry). Ones already sent, or skipped
   * because they had nothing in them, are left as they are.
   */
  async function sendNow(): Promise<{ sent: number; skipped: number; failed: number; retrying: number; alreadyDone: number; off: number }> {
    const tally = { sent: 0, skipped: 0, failed: 0, retrying: 0, alreadyDone: 0, off: 0 };
    const at = now();
    for (const person of await deps.people.list()) {
      if (!person.email) continue;
      const { day } = localClock(at, zoneOf(person));
      for (const kind of KINDS) {
        const { outcome } = await sendOne(person, day, kind, { resend: false, retrySkipped: false });
        if (outcome === 'sent') tally.sent++;
        else if (outcome === 'empty') tally.skipped++;
        else if (outcome === 'retry') {
          tally.failed++;
          tally.retrying++;
        } else if (outcome === 'failed') tally.failed++;
        else if (outcome === 'off') tally.off++;
        else tally.alreadyDone++;
      }
    }
    return tally;
  }

  /**
   * One person's emails for their today, now (or just `kind`). One that already went is sent again only
   * with `resend` (the same record: one more attempt, a new sent time). One skipped earlier is tried
   * again (there may be something in it now). Null: not an active person with an email address.
   */
  async function sendFor(userId: string, opts: { kind?: DailyEmailKind; resend?: boolean } = {}) {
    const person = await deps.people.find(userId);
    if (!person?.email) return null;
    const { day } = localClock(now(), zoneOf(person));
    const results: ManualSendResult[] = [];
    for (const kind of opts.kind ? [opts.kind] : KINDS) {
      results.push(await sendOne(person, day, kind, { resend: opts.resend === true, retrySkipped: true }));
    }
    return { userId: person.id, name: person.name, email: person.email, day, results };
  }

  /**
   * The email as it would be sent now — its subject and plain text, built from the person's tasks as
   * they are now (the server keeps no copy of sent emails). Null: not an active person with an address.
   */
  async function preview(userId: string, kind: DailyEmailKind) {
    const person = await deps.people.find(userId);
    if (!person?.email) return null;
    const at = now();
    const { day } = localClock(at, zoneOf(person));
    const { count, content } = await build(kind, person, day, at);
    return {
      userId: person.id,
      name: person.name,
      email: person.email,
      kind,
      day,
      on: isOn(dailyEmailPrefs(person.prefs), kind),
      subject: content?.subject ?? null,
      text: content?.text ?? null,
      taskCount: content ? count : 0,
      empty: !content,
    };
  }

  /**
   * A day for the administrators: everyone with an email address, their time and time zone, and each
   * email's state; the day's numbers; when the server last checked and when the next email is due.
   * `day` is each person's own calendar day ('YYYY-MM-DD'); left out, each person's today.
   */
  async function overview(day?: string): Promise<DailyEmailOverview> {
    const at = now();
    const people = (await deps.people.list()).filter((p): p is DailyRecipient & { email: string } => Boolean(p.email));
    const local = people.map((person) => {
      const timeZone = zoneOf(person);
      return { person, timeZone, prefs: dailyEmailPrefs(person.prefs), today: localClock(at, timeZone).day };
    });
    const days = new Set(local.map((l) => l.today));
    if (day) days.add(day);
    const rows = new Map((await deps.repo.forDays([...days])).map((r) => [`${r.userId}|${r.day}|${r.kind}`, r] as const));
    const rowOf = (userId: string, d: string, kind: DailyEmailKind) => rows.get(`${userId}|${d}|${kind}`) ?? null;

    const summary = { people: 0, sent: 0, skipped: 0, failed: 0, retrying: 0, sending: 0, upcoming: 0, toSend: 0 };
    let nextSendAt: Date | null = null;
    const out: DailyEmailOverviewPerson[] = [];

    for (const { person, timeZone, prefs, today } of local) {
      const shown = day ?? today;
      const tomorrow = dueOn(shiftDayKey(today, 1), timeZone, prefs.time);
      // Someone who joined after today's time gets their first emails tomorrow (as the sweep does).
      const todayDue = person.createdAt.getTime() > dueOn(today, timeZone, prefs.time).getTime() ? tomorrow : dueOn(today, timeZone, prefs.time);
      const email = (kind: DailyEmailKind): DailyEmailOverviewEmail => {
        const on = isOn(prefs, kind);
        const row = rowOf(person.id, shown, kind);
        const base = { on, dueAt: null, sentAt: null, taskCount: 0, attempts: 0, nextAttemptAt: null, lastError: null };
        if (row) {
          return { ...base, state: row.status, sentAt: row.sentAt, taskCount: row.taskCount, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt, lastError: row.lastError };
        }
        if (!on) return { ...base, state: 'OFF' };
        if (shown < today) return { ...base, state: 'NONE' };
        return { ...base, state: 'DUE', dueAt: shown === today ? todayDue : dueOn(shown, timeZone, prefs.time) };
      };
      const entry: DailyEmailOverviewPerson = {
        userId: person.id,
        name: person.name,
        email: person.email,
        timeZone,
        ownTimeZone: Boolean(person.timeZone) && timeZone === person.timeZone,
        time: prefs.time,
        day: shown,
        pending: email('PENDING'),
        completed: email('COMPLETED'),
      };
      out.push(entry);

      const kindsOn = KINDS.filter((k) => isOn(prefs, k));
      if (kindsOn.length) summary.people++;
      for (const e of [entry.pending, entry.completed]) {
        if (e.state === 'SENT') summary.sent++;
        else if (e.state === 'SKIPPED') summary.skipped++;
        else if (e.state === 'FAILED') summary.failed++;
        else if (e.state === 'RETRY') summary.retrying++;
        else if (e.state === 'SENDING') summary.sending++;
        else if (e.state === 'DUE') summary.upcoming++;
      }
      // "Send now" and the next send are about today, whichever day is shown.
      const todayRows = kindsOn.map((k) => rowOf(person.id, today, k));
      if (todayRows.some((r) => !r || r.status === 'FAILED' || r.status === 'RETRY')) summary.toSend++;
      for (const r of todayRows) {
        const next = r ? tomorrow : todayDue;
        if (!nextSendAt || next < nextSendAt) nextSendAt = next;
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
    return { day: day ?? null, lastCheckedAt: lastChecked, nextSendAt, summary, people: out };
  }

  return { runSweep, sendTest, sendNow, sendFor, preview, overview, lastCheckedAt: () => lastChecked };
}

export type DailyEmailService = ReturnType<typeof createDailyEmailService>;
