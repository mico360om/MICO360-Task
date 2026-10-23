import type { ApiClient } from '../lib/api-client';

export type DailyEmailStatus = 'SENDING' | 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';
export type DailyEmailKind = 'PENDING' | 'COMPLETED';
/**
 * An email's state on a day: OFF (turned off), DUE (still to come), LATE (its time today has passed and
 * it hasn't gone yet), NONE (a past day, nothing recorded), or how it went.
 */
export type DailyEmailState = 'OFF' | 'DUE' | 'LATE' | 'NONE' | DailyEmailStatus;

/** One person's email on the day shown. */
export interface DailyEmailOverviewEmail {
  /** Their setting now. */
  on: boolean;
  state: DailyEmailState;
  /** DUE: when it goes. LATE: when it was due. */
  dueAt: string | null;
  sentAt: string | null;
  taskCount: number;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
}

export interface DailyEmailOverviewPerson {
  userId: string;
  name: string;
  email: string;
  /** The time zone used: their own, else the company's. */
  timeZone: string;
  ownTimeZone: boolean;
  /** 'HH:MM' in that time zone. */
  time: string;
  /** Their calendar day shown. */
  day: string;
  /** Their own today: their emails can be sent for that day only. */
  today: string;
  /** Their time today has come: sending now isn't ahead of it. */
  due: boolean;
  /** 'inactive' / 'no-email': someone who no longer gets these emails (their records stay visible). */
  account: 'active' | 'inactive' | 'no-email';
  pending: DailyEmailOverviewEmail;
  completed: DailyEmailOverviewEmail;
}

/** How "Send today's emails now" went, in emails. */
export interface DailyEmailSendNowCounts {
  sent: number;
  /** Nothing in them. */
  skipped: number;
  /** The address is blocked after a bounce or spam complaint. */
  blocked: number;
  /** Not sent (including those that will be tried again). */
  failed: number;
  /** Of those not sent, how many will be tried again. */
  retrying: number;
  alreadyDone: number;
  /** Being sent at that moment by the server's own check. */
  sending: number;
  off: number;
  /** The person's time today hasn't come: theirs go at their time. */
  notYet: number;
  /** Ran into a problem on the server; the server tries them again by itself. */
  errors: number;
}

/** One "Send today's emails now" on the server: running (how far it has got) or finished. */
export interface DailyEmailSendNowRun {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  /** People with emails to send; null until the server has read the list. */
  total: number | null;
  done: number;
  counts: DailyEmailSendNowCounts;
  /** Why it stopped before the end, else null. */
  error: string | null;
}

export interface DailyEmailOverview {
  /** The day asked for, or null: each person's own today. */
  day: string | null;
  lastCheckedAt: string | null;
  /** The server hasn't checked for a while although emails are due and haven't gone. */
  checkLate?: boolean;
  nextSendAt: string | null;
  /** The latest "Send today's emails now" on the server, or null. */
  run?: DailyEmailSendNowRun | null;
  emailEnabled: boolean;
  summary: { people: number; sent: number; skipped: number; failed: number; retrying: number; sending: number; late?: number; upcoming: number; toSend: number };
  people: DailyEmailOverviewPerson[];
}

export type DailyEmailSendOutcome = 'sent' | 'empty' | 'blocked' | 'retry' | 'failed' | 'already-sent' | 'already-done' | 'busy' | 'off' | 'not-yet';

export interface DailyEmailSendResult {
  userId: string;
  name: string;
  email: string;
  day: string;
  /** Their send time ('HH:MM', their time). */
  time?: string;
  results: Array<{ kind: DailyEmailKind; outcome: DailyEmailSendOutcome; error: string | null; sentAt: string | null }>;
}

/** The email as it would be sent now: subject and plain text (never HTML). */
export interface DailyEmailPreview {
  userId: string;
  name: string;
  email: string;
  kind: DailyEmailKind;
  day: string;
  on: boolean;
  subject: string | null;
  text: string | null;
  taskCount: number;
  empty: boolean;
}

export function dailyEmailsApi(client: ApiClient) {
  return {
    /** A day at a glance; without a day, each person's own today. */
    overview: (day?: string) =>
      client.get<{ data: DailyEmailOverview }>(`/admin/daily-emails/overview${day ? `?day=${encodeURIComponent(day)}` : ''}`).then((r) => r.data),
    /**
     * Starts "Send today's emails now" on the server (it answers at once and sends in the background;
     * the overview says how far it has got). A retried request with the same key starts nothing more.
     */
    sendNow: (idempotencyKey: string) =>
      client.post<{ data: DailyEmailSendNowRun }>('/admin/daily-emails/send-now', {}, { headers: { 'Idempotency-Key': idempotencyKey } }).then((r) => r.data),
    /** One person's email for today, now; `resend` also sends one that already went; `early`: before their time. */
    send: (input: { userId: string; kind: DailyEmailKind; resend: boolean; early?: boolean }, idempotencyKey: string) =>
      client.post<{ data: DailyEmailSendResult }>('/admin/daily-emails/send', input, { headers: { 'Idempotency-Key': idempotencyKey } }).then((r) => r.data),
    preview: (userId: string, kind: DailyEmailKind) =>
      client
        .get<{ data: DailyEmailPreview }>(`/admin/daily-emails/preview?userId=${encodeURIComponent(userId)}&kind=${kind}`)
        .then((r) => r.data),
  };
}
