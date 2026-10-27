import { zonedDayKey } from '../../lib/due-date';
import { instantOf } from '../meetings/meeting-series';
import type { EmailContent } from '../email/email-templates';
import { dailyEmailPrefs, weeklySummaryOn, type NotificationPreferences } from '../notifications/notification-preferences';
import { RETRY_DELAYS_MIN, BLOCKED_ADDRESS } from '../daily-emails/daily-email-service';
import { weekOf, type WeekStart } from '../planning/timeline';
import { firstWorkingDay } from './management-rules';
import type { ManagementViewer, WeeklyDigest } from './management-service';
import type { WeeklySummaryFinish, WeeklySummaryRecord, WeeklySummaryRepository } from './weekly-summary-repository';
import { weeklySummaryEmail } from './weekly-summary-content';

/** An active staff member who may get the weekly summary. */
export interface WeeklyRecipient {
  id: string;
  name: string;
  email: string | null;
  /** Their own time zone, else null (the company's is used). */
  timeZone: string | null;
  prefs: NotificationPreferences;
  createdAt: Date;
  roles: string[];
  /** They run at least one live project (owner, named manager or a MANAGER member). */
  runsProjects: boolean;
}

export interface WeeklySummaryDeps {
  repo: WeeklySummaryRepository;
  people: { list(): Promise<WeeklyRecipient[]>; find(id: string): Promise<WeeklyRecipient | null> };
  /** The person's own figures (the Management page's, for their scope); null: nothing in scope. */
  digest(viewer: ManagementViewer): Promise<WeeklyDigest | null>;
  /** Sends one email; throws when it can't be delivered. 'suppressed': the address is blocked. */
  send(to: string, content: EmailContent, template: string): Promise<'sent' | 'suppressed' | void>;
  /** False while no email provider is set up: nothing is attempted. */
  isConfigured(): boolean;
  /** The company-wide switch (System Settings). */
  enabled(): Promise<boolean>;
  /** The company week's first day and the working days. */
  calendar(): Promise<{ weekStart: WeekStart; workingDays: number[] }>;
  companyTimeZone: string;
  appUrl: string;
  now?: () => Date;
  logger?: { info(msg: string, ctx?: Record<string, unknown>): void; warn(msg: string, ctx?: Record<string, unknown>): void };
}

const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
/** A send still "SENDING" after this long was cut off (a restart mid-send) and is tried again. */
const STUCK_AFTER_MS = 15 * 60 * 1000;
const TEMPLATE = 'weekly-summary';
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

/** Administrators and the people who run a project can see the Management page. */
const canSee = (p: WeeklyRecipient) => p.roles.includes('ADMIN') || p.runsProjects;

/**
 * The weekly management summary. Every minute the sweep sends what is due: on the first working day
 * of the company week (Sunday when the week starts on Sunday), at each person's daily-email time (06:00
 * unless they chose another, in their own time zone), to everyone with an address who can see the
 * Management page and hasn't turned it off — a summary of their own projects. One record per person
 * and week makes sure it goes once; someone with nothing in scope is skipped (no email). A failed send
 * is tried again after 5, 15 and 45 minutes, then given up, as the daily task emails are. A server that
 * was asleep catches up later the same day. The company-wide switch turns it off for everyone.
 */
export function createWeeklySummaryService(deps: WeeklySummaryDeps) {
  const now = deps.now ?? (() => new Date());
  let warnedNotConfigured = false;

  function timing(person: WeeklyRecipient, at: Date, cal: { weekStart: WeekStart; workingDays: number[] }) {
    const timeZone = validZone(person.timeZone, deps.companyTimeZone);
    const today = zonedDayKey(at, timeZone);
    const week = weekOf(today, cal.weekStart);
    const sendDay = firstWorkingDay(week, cal.workingDays);
    const dueAt = instantOf(new Date(`${sendDay}T${dailyEmailPrefs(person.prefs).time}:00.000Z`), timeZone);
    const joinedLate = person.createdAt.getTime() > dueAt.getTime();
    return { week, due: today === sendDay && !joinedLate && at.getTime() >= dueAt.getTime() };
  }

  type Outcome = 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';

  async function attempt(taken: WeeklySummaryRecord, person: WeeklyRecipient | null): Promise<Outcome> {
    const at = now();
    const finish = (patch: WeeklySummaryFinish) => deps.repo.finish(taken, patch);
    const failed = async (err: unknown): Promise<Outcome> => {
      const error = messageOf(err);
      if (taken.attempts >= MAX_ATTEMPTS) {
        await finish({ status: 'FAILED', lastError: error, nextAttemptAt: null });
        deps.logger?.warn('weekly management summary failed for good', { userId: taken.userId, week: taken.week, error });
        return 'FAILED';
      }
      await finish({ status: 'RETRY', lastError: error, nextAttemptAt: new Date(at.getTime() + RETRY_DELAYS_MIN[taken.attempts - 1]! * 60_000) });
      return 'RETRY';
    };
    const skipped = async (why: string | null): Promise<Outcome> => {
      await finish({ status: 'SKIPPED', projectCount: 0, nextAttemptAt: null, lastError: why });
      return 'SKIPPED';
    };
    // Gone, no address, turned off or no longer able to see the page since it was due: nothing goes.
    if (!person || !person.email || !weeklySummaryOn(person.prefs) || !canSee(person)) return skipped(person ? null : 'The account is no longer active.');
    let digest: WeeklyDigest | null;
    try {
      digest = await deps.digest({ id: person.id, roles: person.roles });
    } catch (err) {
      return failed(err);
    }
    if (!digest) return skipped(null); // nothing in scope
    const content = weeklySummaryEmail({ name: person.name, digest, week: taken.week, appUrl: deps.appUrl });
    let result: 'sent' | 'suppressed' | void;
    try {
      result = await deps.send(person.email, content, TEMPLATE);
    } catch (err) {
      return failed(err);
    }
    if (result === 'suppressed') return skipped(BLOCKED_ADDRESS);
    try {
      await finish({ status: 'SENT', projectCount: digest.projects, sentAt: at, nextAttemptAt: null, lastError: null });
    } catch (err) {
      // It went: a problem writing that down must never send it again (the row stays SENDING until it is stale).
      deps.logger?.warn('weekly management summary went, but writing that down failed', { userId: taken.userId, week: taken.week, error: messageOf(err) });
    }
    return 'SENT';
  }

  async function runSweep(): Promise<Record<Outcome, number>> {
    const tally: Record<Outcome, number> = { SENT: 0, SKIPPED: 0, RETRY: 0, FAILED: 0 };
    if (!deps.isConfigured()) {
      if (!warnedNotConfigured) deps.logger?.warn('The weekly management summary is waiting: email sending is not set up on this server');
      warnedNotConfigured = true;
      return tally;
    }
    warnedNotConfigured = false;
    if (!(await deps.enabled())) return tally;
    const at = now();
    const cal = await deps.calendar();
    const due = (await deps.people.list()).filter((p) => p.email && weeklySummaryOn(p.prefs) && canSee(p)).map((p) => ({ p, ...timing(p, at, cal) })).filter((x) => x.due);
    if (due.length) {
      const had = new Set((await deps.repo.forWeeks([...new Set(due.map((x) => x.week))])).map((r) => `${r.userId}|${r.week}`));
      for (const { p, week } of due) {
        if (had.has(`${p.id}|${week}`)) continue;
        const row = await deps.repo.claim(p.id, week);
        if (row) tally[await attempt(row, p)]++;
      }
    }
    // Leftover retries are tried even when nobody new is due.
    for (const row of await deps.repo.dueForRetry(at, new Date(at.getTime() - STUCK_AFTER_MS))) {
      const taken = await deps.repo.retake(row);
      if (!taken) continue;
      tally[await attempt(taken, await deps.people.find(taken.userId))]++;
    }
    if (tally.SENT || tally.RETRY || tally.FAILED) deps.logger?.info('weekly management summaries', tally);
    return tally;
  }

  return { runSweep };
}

export type WeeklySummaryService = ReturnType<typeof createWeeklySummaryService>;
