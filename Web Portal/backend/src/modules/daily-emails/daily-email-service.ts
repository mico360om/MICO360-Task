import { shiftDayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';
import { instantOf } from '../meetings/meeting-series';
import type { EmailContent } from '../email/email-templates';
import { dailyEmailPrefs, type NotificationPreferences } from '../notifications/notification-preferences';
import { completedEmail, pendingEmail, type DailyTask } from './daily-email-content';
import type { DailyEmailDayRow, DailyEmailFinish, DailyEmailKind, DailyEmailRecord, DailyEmailRepository, DailyEmailStatus } from './daily-email-repository';

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
  /**
   * Sends one email; throws when it can't be delivered. 'suppressed': the address is blocked after a
   * bounce or spam complaint, so nothing was sent.
   */
  send(to: string, content: EmailContent, template: string): Promise<'sent' | 'suppressed' | void>;
  /** False while no email provider is set up: nothing is attempted (and nothing piles up). */
  isConfigured(): boolean;
  companyTimeZone: string;
  appUrl: string;
  /** Where the server serves stored files ("/uploads/…"), for project pictures email clients can load. */
  assetUrl?: string;
  now?: () => Date;
  logger?: { info(msg: string, ctx?: Record<string, unknown>): void; warn(msg: string, ctx?: Record<string, unknown>): void };
  /**
   * When the sweep last ran, kept in the database so every server (and a restart) knows it. Without
   * it, only this server's own memory.
   */
  checks?: { record(at: Date): Promise<void>; last(): Promise<Date | null> };
}

/** Longer than this without a check while emails are due: the server isn't checking (asleep, stopped). */
export const CHECK_LATE_MS = 5 * 60_000;

/**
 * One email's state on a day, for the administrators: OFF (turned off, nothing recorded), DUE (still
 * to come: `dueAt`), LATE (its time today has passed and it hasn't gone yet: email not set up, or the
 * server asleep), NONE (a past day with nothing recorded), else the delivery record's status.
 */
export type DailyEmailState = 'OFF' | 'DUE' | 'LATE' | 'NONE' | DailyEmailStatus;

export interface DailyEmailOverviewEmail {
  /** The person's setting now. */
  on: boolean;
  state: DailyEmailState;
  /** DUE: when it goes — that day's time, or tomorrow's for someone who joined after today's. LATE: when it was due. */
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
  /** Their own today ('YYYY-MM-DD'): their emails can be sent for that day only. */
  today: string;
  /** Their time today has come (and they joined before it): sending now isn't ahead of their time. */
  due: boolean;
  /** 'inactive' / 'no-email': records of someone who no longer gets these emails, shown so they stay visible. */
  account: 'active' | 'inactive' | 'no-email';
  pending: DailyEmailOverviewEmail;
  completed: DailyEmailOverviewEmail;
}

export interface DailyEmailOverview {
  /** The day asked for, or null: each person's own today. */
  day: string | null;
  /** When the sweep last ran (on any server); null when it never has. */
  lastCheckedAt: Date | null;
  /**
   * The server hasn't checked for over 5 minutes (or never has) although emails are due and haven't
   * gone: the sweep isn't running (asleep, stopped). Never while email isn't set up.
   */
  checkLate: boolean;
  /** The next time any person's email is due (it may have passed: due now). */
  nextSendAt: Date | null;
  /** The latest "Send today's emails now" on this server: running (how far it has got) or finished; null: none since it started. */
  run: SendNowRun | null;
  summary: {
    /** People who get at least one email (an address, at least one turned on). */
    people: number;
    sent: number;
    skipped: number;
    failed: number;
    retrying: number;
    sending: number;
    /** Due, not sent yet: their time has passed and no attempt is recorded. */
    late: number;
    /** Still to come that day. */
    upcoming: number;
    /**
     * People "Send today's emails now" would send to: their time today has come and an email turned on
     * hasn't gone (none yet, failed, waiting for a retry). It is always about today.
     */
    toSend: number;
  };
  people: DailyEmailOverviewPerson[];
}

/**
 * How an administrator's send of one email went ('blocked': the address is blocked after a bounce or
 * spam complaint; 'not-yet': their time today hasn't come, and sending early wasn't asked for).
 */
export type ManualSendOutcome = 'sent' | 'empty' | 'blocked' | 'retry' | 'failed' | 'already-sent' | 'already-done' | 'busy' | 'off' | 'not-yet';
export interface ManualSendResult {
  kind: DailyEmailKind;
  outcome: ManualSendOutcome;
  /** Why it couldn't be sent (retry, failed). */
  error: string | null;
  /** When it went: now (sent), or the earlier send (already-sent, or a resend that failed). */
  sentAt: Date | null;
}

/** How "Send today's emails now" went, in emails. */
export interface SendNowCounts {
  sent: number;
  /** Nothing in them. */
  skipped: number;
  /** The address is blocked after a bounce or spam complaint. */
  blocked: number;
  /** Couldn't be sent (including those that will be tried again). */
  failed: number;
  /** Of those not sent, how many will be tried again. */
  retrying: number;
  /** Already sent (or skipped) today. */
  alreadyDone: number;
  /** Being sent at that moment by the server's own check. */
  sending: number;
  /** Turned off. */
  off: number;
  /** The person's time today hasn't come: theirs go at their time. */
  notYet: number;
  /** Ran into a problem on the server (the database didn't answer); the server tries them again later. */
  errors: number;
}

/** One "Send today's emails now", running or finished. */
export interface SendNowRun {
  running: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  /** People with emails to send (their time has come, something not gone yet); null until the list is read. */
  total: number | null;
  /** Of those, how many are done so far. */
  done: number;
  counts: SendNowCounts;
  /** Why it stopped before the end (the list of people couldn't be read), else null. */
  error: string | null;
}

const emptyCounts = (): SendNowCounts => ({ sent: 0, skipped: 0, blocked: 0, failed: 0, retrying: 0, alreadyDone: 0, sending: 0, off: 0, notYet: 0, errors: 0 });
function countOutcome(c: SendNowCounts, outcome: ManualSendOutcome): void {
  if (outcome === 'sent') c.sent++;
  else if (outcome === 'empty') c.skipped++;
  else if (outcome === 'blocked') c.blocked++;
  else if (outcome === 'retry') {
    c.failed++;
    c.retrying++;
  } else if (outcome === 'failed') c.failed++;
  else if (outcome === 'busy') c.sending++;
  else if (outcome === 'off') c.off++;
  else if (outcome === 'not-yet') c.notYet++;
  else c.alreadyDone++;
}

/** A failed send is tried again after 5, 15 and 45 minutes; the fourth failure is final. */
export const RETRY_DELAYS_MIN = [5, 15, 45];
const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
/** A send still "SENDING" after this long was cut off (a restart mid-send) and is tried again. */
const STUCK_AFTER_MS = 15 * 60 * 1000;
const KINDS: DailyEmailKind[] = ['PENDING', 'COMPLETED'];
const TEMPLATE: Record<DailyEmailKind, string> = { PENDING: 'daily-pending', COMPLETED: 'daily-completed' };
/** Why an email to an address the provider reported (a hard bounce, a spam complaint) wasn't sent. */
export const BLOCKED_ADDRESS = 'Address blocked after a bounce or spam complaint.';
/** How one email of "Send me a test now" went. */
export type TestOutcome = 'sent' | 'empty' | 'blocked';
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function validZone(tz: string | null, fallback: string): string {
  if (!tz) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

/** The calendar day at `now` in a time zone. */
function localClock(now: Date, timeZone: string): { day: string } {
  return { day: zonedDayKey(now, timeZone) };
}
/** The instant someone's emails are due on a day: their time by the clocks there that day (clock changes included). */
const dueOn = (day: string, timeZone: string, time: string) => instantOf(new Date(`${day}T${time}:00.000Z`), timeZone);
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

  /**
   * A person's today and their time that day: `due` once it has come — unless they joined after it
   * (their first emails are the next morning's). Nothing is ever sent for them before then, except
   * when an administrator asks to send early.
   */
  function timing(person: DailyRecipient, at: Date) {
    const timeZone = zoneOf(person);
    const prefs = dailyEmailPrefs(person.prefs);
    const today = localClock(at, timeZone).day;
    const dueAt = dueOn(today, timeZone, prefs.time);
    const joinedLate = person.createdAt.getTime() > dueAt.getTime();
    return { timeZone, prefs, today, dueAt, joinedLate, due: !joinedLate && at.getTime() >= dueAt.getTime() };
  }

  /** The sweep checked at `at`: kept here and in the database (a problem writing it never stops the sweep). */
  async function noteChecked(at: Date): Promise<void> {
    lastChecked = at;
    try {
      await deps.checks?.record(at);
    } catch (err) {
      deps.logger?.warn('could not write down when the daily emails were last checked', { error: messageOf(err) });
    }
  }
  /** When the sweep last ran on any server: the later of the database's time and this server's own. */
  async function lastCheckedAt(): Promise<Date | null> {
    let stored: Date | null = null;
    try {
      stored = (await deps.checks?.last()) ?? null;
    } catch {
      /* the database didn't answer: this server's own time */
    }
    if (!stored) return lastChecked;
    return lastChecked && lastChecked > stored ? lastChecked : stored;
  }

  async function build(kind: DailyEmailKind, person: DailyRecipient, day: string, at: Date): Promise<{ count: number; content: EmailContent | null }> {
    const timeZone = zoneOf(person);
    if (kind === 'PENDING') {
      const tasks = await deps.tasks.pending(person.id);
      return { count: tasks.length, content: tasks.length ? pendingEmail({ name: person.name, tasks, timeZone, now: at, appUrl: deps.appUrl, assetUrl: deps.assetUrl }) : null };
    }
    const yesterday = shiftDayKey(day, -1);
    const tasks = await deps.tasks.completedBetween(person.id, zonedStartOfDay(yesterday, timeZone), zonedStartOfDay(day, timeZone));
    return { count: tasks.length, content: tasks.length ? completedEmail({ name: person.name, tasks, day: yesterday, timeZone, now: at, appUrl: deps.appUrl, assetUrl: deps.assetUrl }) : null };
  }

  interface Attempted {
    status: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';
    error: string | null;
    sentAt: Date | null;
    /** Not sent: the address is blocked after a bounce or spam complaint. */
    blocked?: boolean;
  }

  /**
   * Emails that went but whose record couldn't be written (the database didn't answer): written at the
   * next check — meanwhile their record is never taken again, so they are never sent a second time.
   */
  const unrecorded = new Map<string, { taken: DailyEmailRecord; patch: DailyEmailFinish }>();

  /** Writes down how an attempt went, for an email that may have gone: never throws. */
  async function recordSent(taken: DailyEmailRecord, patch: DailyEmailFinish): Promise<void> {
    try {
      if (!(await deps.repo.finish(taken, patch))) {
        deps.logger?.warn('daily task email: its record was taken by another send meanwhile', { userId: taken.userId, kind: taken.kind, day: taken.day });
      }
    } catch (err) {
      unrecorded.set(taken.id, { taken, patch });
      deps.logger?.warn('daily task email went, but writing that down failed; it is written at the next check', { userId: taken.userId, kind: taken.kind, day: taken.day, error: messageOf(err) });
    }
  }

  async function writeUnrecorded(): Promise<void> {
    for (const [id, { taken, patch }] of unrecorded) {
      try {
        await deps.repo.finish(taken, patch);
        unrecorded.delete(id);
      } catch {
        /* still not answering: next time */
      }
    }
  }

  /**
   * Sends a taken (SENDING) row and records how it went. An email that went before (`sentAt`: a resend,
   * or a resend cut off part-way) stays counted as sent whatever happens — a failure is noted, never
   * retried by the sweep. `manual`: an administrator's try; one that fails while the email waits for an
   * automatic retry (`before` was RETRY) leaves those retries as they were. The send and the writing
   * down are apart: an email that went is never retried because writing it down failed.
   */
  async function attempt(taken: DailyEmailRecord, person: DailyRecipient, opts: { manual?: boolean; before?: DailyEmailRecord | null } = {}): Promise<Attempted> {
    const again = taken.sentAt !== null;
    const at = now();
    const finish = (patch: DailyEmailFinish) => deps.repo.finish(taken, patch);

    const failed = async (err: unknown): Promise<Attempted> => {
      const error = messageOf(err);
      if (again) {
        await finish({ status: 'SENT', nextAttemptAt: null, lastError: error });
        return { status: 'FAILED', error, sentAt: taken.sentAt };
      }
      if (opts.manual && opts.before?.status === 'RETRY') {
        await finish({ status: 'RETRY', attempts: opts.before.attempts, nextAttemptAt: opts.before.nextAttemptAt, lastError: error });
        return { status: 'RETRY', error, sentAt: null };
      }
      if (taken.attempts >= MAX_ATTEMPTS) {
        await finish({ status: 'FAILED', lastError: error, nextAttemptAt: null });
        deps.logger?.warn('daily task email failed for good', { userId: taken.userId, kind: taken.kind, day: taken.day, error });
        return { status: 'FAILED', error, sentAt: null };
      }
      const delay = RETRY_DELAYS_MIN[taken.attempts - 1]!;
      await finish({ status: 'RETRY', lastError: error, nextAttemptAt: new Date(at.getTime() + delay * 60_000) });
      return { status: 'RETRY', error, sentAt: null };
    };
    /** Nothing goes (turned off, no address, nothing in it, a blocked address). */
    const skipped = async (error: string | null): Promise<Attempted> => {
      if (again) await recordSent(taken, { status: 'SENT', nextAttemptAt: null, ...(error ? { lastError: error } : {}) });
      else await finish({ status: 'SKIPPED', taskCount: 0, nextAttemptAt: null, lastError: error });
      return { status: 'SKIPPED', error, sentAt: again ? taken.sentAt : null, ...(error === BLOCKED_ADDRESS ? { blocked: true } : {}) };
    };

    let built: { count: number; content: EmailContent | null } = { count: 0, content: null };
    try {
      if (person.email && isOn(dailyEmailPrefs(person.prefs), taken.kind)) built = await build(taken.kind, person, taken.day, at);
    } catch (err) {
      return failed(err);
    }
    if (!person.email || !built.content) return skipped(null); // turned off since it was due, or nothing in it
    let result: 'sent' | 'suppressed' | void;
    try {
      result = await deps.send(person.email, built.content, TEMPLATE[taken.kind]);
    } catch (err) {
      return failed(err);
    }
    if (result === 'suppressed') return skipped(BLOCKED_ADDRESS);
    await recordSent(taken, { status: 'SENT', taskCount: built.count, sentAt: at, nextAttemptAt: null, lastError: null });
    return { status: 'SENT', error: null, sentAt: at };
  }

  async function runSweep(): Promise<Record<'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED', number>> {
    const tally = { SENT: 0, SKIPPED: 0, RETRY: 0, FAILED: 0 };
    const count = (s: Attempted['status']) => {
      tally[s]++;
    };
    const at = now();
    await writeUnrecorded();
    // Written as it starts: a sweep busy sending for minutes is still checking.
    await noteChecked(at);
    if (!deps.isConfigured()) {
      if (!warnedNotConfigured) deps.logger?.warn('Daily task emails are waiting: email sending is not set up on this server');
      warnedNotConfigured = true;
      return tally;
    }
    warnedNotConfigured = false;

    for (const person of await deps.people.list()) {
      if (!person.email) continue;
      // Their time today hasn't come (or they joined after it: they start the morning after).
      const { prefs, today, due } = timing(person, at);
      if (!due) continue;
      for (const kind of KINDS) {
        if (!isOn(prefs, kind)) continue;
        const row = await deps.repo.claim(person.id, today, kind);
        if (row) count((await attempt(row, person)).status);
      }
    }

    for (const due of await deps.repo.dueForRetry(at, new Date(at.getTime() - STUCK_AFTER_MS))) {
      if (unrecorded.has(due.id)) continue; // it went: only writing that down is still to do
      const taken = await deps.repo.retake(due);
      if (!taken) continue;
      const person = await deps.people.find(taken.userId);
      if (!person) {
        await deps.repo.finish(taken, { status: taken.sentAt ? 'SENT' : 'SKIPPED', ...(taken.sentAt ? {} : { taskCount: 0 }), nextAttemptAt: null, lastError: 'The account is no longer active.' });
        count('SKIPPED');
        continue;
      }
      count((await attempt(taken, person)).status);
    }
    if (tally.SENT || tally.RETRY || tally.FAILED) deps.logger?.info('daily task emails', tally);
    return tally;
  }

  /**
   * Both emails to the person now, whatever their settings — not counted as today's. Each is 'sent',
   * 'empty' (nothing in it, so not sent) or 'blocked' (the address is blocked after a bounce or spam
   * complaint, so nothing was sent).
   */
  async function sendTest(userId: string): Promise<{ pending: TestOutcome; completed: TestOutcome }> {
    const person = await deps.people.find(userId);
    if (!person?.email) throw new Error('Your account has no email address.');
    const at = now();
    const { day } = localClock(at, zoneOf(person));
    const result: { pending: TestOutcome; completed: TestOutcome } = { pending: 'empty', completed: 'empty' };
    for (const kind of KINDS) {
      const { content } = await build(kind, person, day, at);
      if (!content) continue;
      const delivered = await deps.send(person.email, content, `${TEMPLATE[kind]}-test`);
      result[kind === 'PENDING' ? 'pending' : 'completed'] = delivered === 'suppressed' ? 'blocked' : 'sent';
    }
    return result;
  }

  const OUTCOME: Record<Attempted['status'], ManualSendOutcome> = { SENT: 'sent', SKIPPED: 'empty', RETRY: 'retry', FAILED: 'failed' };

  /**
   * An administrator's send of one person's email for `day` (their today), through the same record as
   * the sweep: a new one is claimed; a failed or retrying one is taken again; a skipped one too when
   * `retrySkipped`; a sent one only for a `resend`. One being sent right now is left alone. Never an
   * email the person turned off, and nothing before their time (`notYet`) but a resend.
   */
  async function sendOne(
    person: DailyRecipient,
    day: string,
    kind: DailyEmailKind,
    opts: { resend: boolean; retrySkipped: boolean; notYet?: boolean },
  ): Promise<ManualSendResult> {
    const result = (outcome: ManualSendOutcome, error: string | null = null, sentAt: Date | null = null): ManualSendResult => ({ kind, outcome, error, sentAt });
    if (!isOn(dailyEmailPrefs(person.prefs), kind)) return result('off');
    // Before their time today: only one that already went can be resent (or it says it went).
    if (opts.notYet && (await deps.repo.find(person.id, day, kind))?.status !== 'SENT') return result('not-yet');
    let row = await deps.repo.claim(person.id, day, kind);
    let before: DailyEmailRecord | null = null;
    if (!row) {
      before = await deps.repo.find(person.id, day, kind);
      if (!before || before.status === 'SENDING') return result('busy');
      if (before.status === 'SENT' && !opts.resend) return result('already-sent', null, before.sentAt);
      if (before.status === 'SKIPPED' && !opts.retrySkipped) return result('already-done');
      row = await deps.repo.retake(before);
      if (!row) return result('busy'); // someone else took it a moment ago
    }
    const done = await attempt(row, person, { manual: true, before });
    return result(done.blocked ? 'blocked' : OUTCOME[done.status], done.error, done.sentAt);
  }

  /** The latest "Send today's emails now" on this server (one runs at a time), for the overview. */
  let latestRun: SendNowRun | null = null;
  const snapshot = (run: SendNowRun): SendNowRun => ({ ...run, counts: { ...run.counts } });

  /**
   * "Send today's emails now": everyone's emails for their today whose time has come — each one turned
   * on that hasn't gone yet (none, failed or waiting for a retry). Never ahead of a person's time (late
   * in the company's evening it would be the next day's in their night): theirs go at their time. Ones
   * already sent, or skipped because they had nothing in them, are left as they are.
   *
   * It starts at once and runs in the background (one at a time on this server: pressing again while it
   * runs starts nothing new); how far it has got is in the overview. A problem with one email is noted
   * and the rest go on. `onFinish` is called once at the end, with the counts so far.
   */
  function startSendNow(opts: { onFinish?: (run: SendNowRun) => void | Promise<void> } = {}): { started: boolean; run: SendNowRun; finished: Promise<SendNowRun> } {
    if (latestRun?.running) return { started: false, run: snapshot(latestRun), finished: Promise.resolve(snapshot(latestRun)) };
    const run: SendNowRun = { running: true, startedAt: now(), finishedAt: null, total: null, done: 0, counts: emptyCounts(), error: null };
    latestRun = run;
    const finished = (async () => {
      try {
        await sendEveryone(run);
      } catch (err) {
        run.error = messageOf(err);
        deps.logger?.warn('"Send today’s emails now" stopped early', { error: run.error });
      } finally {
        run.finishedAt = now();
        run.running = false;
      }
      try {
        await opts.onFinish?.(snapshot(run));
      } catch {
        /* the emails stand */
      }
      return snapshot(run);
    })();
    return { started: true, run: snapshot(run), finished };
  }

  async function sendEveryone(run: SendNowRun): Promise<void> {
    const at = run.startedAt;
    const c = run.counts;
    const plans = (await deps.people.list()).filter((p) => p.email).map((person) => ({ person, ...timing(person, at) }));
    const rows = new Map((await deps.repo.forDays([...new Set(plans.map((p) => p.today))])).map((r) => [`${r.userId}|${r.day}|${r.kind}`, r] as const));
    const todo: Array<{ person: DailyRecipient; today: string; kinds: DailyEmailKind[] }> = [];
    for (const { person, prefs, today, due } of plans) {
      const kinds: DailyEmailKind[] = [];
      for (const kind of KINDS) {
        const row = rows.get(`${person.id}|${today}|${kind}`);
        if (!isOn(prefs, kind)) c.off++;
        else if (!due) c.notYet++; // theirs go at their time, by the sweep
        else if (!row || row.status === 'FAILED' || row.status === 'RETRY') kinds.push(kind);
        else if (row.status === 'SENDING') c.sending++; // the sweep is sending it right now
        else c.alreadyDone++;
      }
      if (kinds.length) todo.push({ person, today, kinds });
    }
    run.total = todo.length;
    for (const { person, today, kinds } of todo) {
      for (const kind of kinds) {
        try {
          const { outcome } = await sendOne(person, today, kind, { resend: false, retrySkipped: false });
          countOutcome(c, outcome);
        } catch (err) {
          // One email's problem (the database didn't answer): noted; the sweep picks it up later.
          c.errors++;
          deps.logger?.warn('"Send today’s emails now": one email ran into a problem', { userId: person.id, kind, error: messageOf(err) });
        }
      }
      run.done++;
    }
  }

  /**
   * One person's emails for their today, now (or just `kind`). One that already went is sent again only
   * with `resend` (the same record: one more attempt, a new sent time). One skipped earlier is tried
   * again (there may be something in it now). Before their time today only with `early` ('not-yet'
   * otherwise). Null: not an active person with an email address.
   */
  async function sendFor(userId: string, opts: { kind?: DailyEmailKind; resend?: boolean; early?: boolean } = {}) {
    const person = await deps.people.find(userId);
    if (!person?.email) return null;
    const { prefs, today, due } = timing(person, now());
    const results: ManualSendResult[] = [];
    for (const kind of opts.kind ? [opts.kind] : KINDS) {
      results.push(await sendOne(person, today, kind, { resend: opts.resend === true, retrySkipped: true, notYet: !due && opts.early !== true }));
    }
    return { userId: person.id, name: person.name, email: person.email, day: today, time: prefs.time, results };
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
   * `day` is each person's own calendar day ('YYYY-MM-DD'); left out, each person's today. Records of
   * someone who no longer gets these emails (no longer active, no address now) are shown too.
   */
  async function overview(day?: string): Promise<DailyEmailOverview> {
    const at = now();
    const everyone = await deps.people.list();
    const people = everyone.filter((p): p is DailyRecipient & { email: string } => Boolean(p.email));
    const local = people.map((person) => ({ person, ...timing(person, at) }));
    const days = new Set(local.map((l) => l.today));
    if (day) days.add(day);
    const records = await deps.repo.forDays([...days]);
    const rows = new Map(records.map((r) => [`${r.userId}|${r.day}|${r.kind}`, r] as const));
    const rowOf = (userId: string, d: string, kind: DailyEmailKind) => rows.get(`${userId}|${d}|${kind}`) ?? null;

    const summary = { people: 0, sent: 0, skipped: 0, failed: 0, retrying: 0, sending: 0, late: 0, upcoming: 0, toSend: 0 };
    let nextSendAt: Date | null = null;
    let dueNotSent = false;
    const out: DailyEmailOverviewPerson[] = [];
    const blank = (on: boolean, state: DailyEmailState, dueAt: Date | null = null): DailyEmailOverviewEmail => ({
      on, state, dueAt, sentAt: null, taskCount: 0, attempts: 0, nextAttemptAt: null, lastError: null,
    });
    const fromRow = (on: boolean, row: DailyEmailRecord): DailyEmailOverviewEmail => ({
      ...blank(on, row.status), sentAt: row.sentAt, taskCount: row.taskCount, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt, lastError: row.lastError,
    });
    const STATE_COUNT: Partial<Record<DailyEmailState, keyof typeof summary>> = {
      SENT: 'sent', SKIPPED: 'skipped', FAILED: 'failed', RETRY: 'retrying', SENDING: 'sending', LATE: 'late',
    };
    const tally = (e: DailyEmailOverviewEmail) => {
      const key = STATE_COUNT[e.state];
      if (key) summary[key]++;
    };

    for (const { person, timeZone, prefs, today, dueAt, joinedLate, due } of local) {
      const shown = day ?? today;
      const tomorrow = dueOn(shiftDayKey(today, 1), timeZone, prefs.time);
      // Someone who joined after today's time gets their first emails tomorrow (as the sweep does).
      const todayDue = joinedLate ? tomorrow : dueAt;
      const email = (kind: DailyEmailKind): DailyEmailOverviewEmail => {
        const on = isOn(prefs, kind);
        const row = rowOf(person.id, shown, kind);
        if (row) return fromRow(on, row);
        if (!on) return blank(false, 'OFF');
        if (shown < today) return blank(true, 'NONE');
        if (shown > today) return blank(true, 'DUE', dueOn(shown, timeZone, prefs.time));
        return blank(true, due ? 'LATE' : 'DUE', todayDue);
      };
      const entry: DailyEmailOverviewPerson = {
        userId: person.id,
        name: person.name,
        email: person.email,
        timeZone,
        ownTimeZone: Boolean(person.timeZone) && timeZone === person.timeZone,
        time: prefs.time,
        day: shown,
        today,
        due,
        account: 'active',
        pending: email('PENDING'),
        completed: email('COMPLETED'),
      };
      out.push(entry);

      const kindsOn = KINDS.filter((k) => isOn(prefs, k));
      if (kindsOn.length) summary.people++;
      for (const e of [entry.pending, entry.completed]) {
        tally(e);
        // Still to come that day (not someone's first emails tomorrow).
        if (e.state === 'DUE' && !(shown === today && joinedLate)) summary.upcoming++;
      }
      // "Send now" and the next send are about today, whichever day is shown.
      const todayRows = kindsOn.map((k) => rowOf(person.id, today, k));
      if (due && todayRows.some((r) => !r || r.status === 'FAILED' || r.status === 'RETRY')) summary.toSend++;
      if (due && todayRows.some((r) => !r)) dueNotSent = true;
      for (const r of todayRows) {
        // Not sent yet: today's time (passed: due now); waiting for a retry: that try; else tomorrow's.
        const next = !r ? todayDue : r.status === 'RETRY' && r.nextAttemptAt ? r.nextAttemptAt : tomorrow;
        if (!nextSendAt || next < nextSendAt) nextSendAt = next;
      }
    }

    // Records of people who no longer get these emails stay visible: no Send, no Preview.
    const shownIds = new Set(out.map((p) => p.userId));
    const known = new Map(everyone.map((p) => [p.id, p] as const));
    const others = new Map<string, DailyEmailDayRow[]>();
    for (const r of records) if (!shownIds.has(r.userId)) others.set(r.userId, [...(others.get(r.userId) ?? []), r]);
    for (const [userId, theirs] of others) {
      const first = theirs[0]!;
      const stillHere = known.get(userId);
      const ownZone = stillHere?.timeZone ?? first.timeZone ?? null;
      const timeZone = validZone(ownZone, deps.companyTimeZone);
      const today = localClock(at, timeZone).day;
      const shown = day ?? today;
      const of = (kind: DailyEmailKind) => theirs.find((r) => r.day === shown && r.kind === kind) ?? null;
      if (!of('PENDING') && !of('COMPLETED')) continue;
      const prefs = stillHere ? dailyEmailPrefs(stillHere.prefs) : null;
      const email = (kind: DailyEmailKind) => {
        const row = of(kind);
        const on = prefs ? isOn(prefs, kind) : false;
        return row ? fromRow(on, row) : blank(on, 'NONE');
      };
      const entry: DailyEmailOverviewPerson = {
        userId,
        name: stillHere?.name ?? first.userName,
        email: first.email,
        timeZone,
        ownTimeZone: Boolean(ownZone) && timeZone === ownZone,
        time: prefs?.time ?? '',
        day: shown,
        today,
        due: false,
        account: stillHere ? 'no-email' : 'inactive',
        pending: email('PENDING'),
        completed: email('COMPLETED'),
      };
      out.push(entry);
      tally(entry.pending);
      tally(entry.completed);
    }

    out.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
    const checked = await lastCheckedAt();
    const checkLate = deps.isConfigured() && dueNotSent && (!checked || at.getTime() - checked.getTime() > CHECK_LATE_MS);
    return { day: day ?? null, lastCheckedAt: checked, checkLate, nextSendAt, run: latestRun ? snapshot(latestRun) : null, summary, people: out };
  }

  return { runSweep, sendTest, startSendNow, sendFor, preview, overview, lastCheckedAt };
}

export type DailyEmailService = ReturnType<typeof createDailyEmailService>;
