import type { ApiClient } from '../lib/api-client';

export type DailyEmailStatus = 'SENDING' | 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';
export type DailyEmailKind = 'PENDING' | 'COMPLETED';
/** An email's state on a day: OFF (turned off), DUE (still to come), NONE (a past day, nothing recorded), or how it went. */
export type DailyEmailState = 'OFF' | 'DUE' | 'NONE' | DailyEmailStatus;

/** One person's email on the day shown. */
export interface DailyEmailOverviewEmail {
  /** Their setting now. */
  on: boolean;
  state: DailyEmailState;
  /** DUE: when it goes (it may have passed: due now). */
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
  pending: DailyEmailOverviewEmail;
  completed: DailyEmailOverviewEmail;
}

export interface DailyEmailOverview {
  /** The day asked for, or null: each person's own today. */
  day: string | null;
  lastCheckedAt: string | null;
  nextSendAt: string | null;
  emailEnabled: boolean;
  summary: { people: number; sent: number; skipped: number; failed: number; retrying: number; sending: number; upcoming: number; toSend: number };
  people: DailyEmailOverviewPerson[];
}

export interface DailyEmailSendNowResult {
  sent: number;
  skipped: number;
  /** Not sent (including those that will be tried again). */
  failed: number;
  /** Of those not sent, how many will be tried again. */
  retrying: number;
  alreadyDone: number;
  off: number;
}

export type DailyEmailSendOutcome = 'sent' | 'empty' | 'retry' | 'failed' | 'already-sent' | 'already-done' | 'busy' | 'off';

export interface DailyEmailSendResult {
  userId: string;
  name: string;
  email: string;
  day: string;
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
    /** Today's emails to everyone who hasn't had them. A retried request with the same key sends nothing more. */
    sendNow: (idempotencyKey: string) =>
      client.post<{ data: DailyEmailSendNowResult }>('/admin/daily-emails/send-now', {}, { headers: { 'Idempotency-Key': idempotencyKey } }).then((r) => r.data),
    /** One person's email for today, now; `resend` also sends one that already went. */
    send: (input: { userId: string; kind: DailyEmailKind; resend: boolean }, idempotencyKey: string) =>
      client.post<{ data: DailyEmailSendResult }>('/admin/daily-emails/send', input, { headers: { 'Idempotency-Key': idempotencyKey } }).then((r) => r.data),
    preview: (userId: string, kind: DailyEmailKind) =>
      client
        .get<{ data: DailyEmailPreview }>(`/admin/daily-emails/preview?userId=${encodeURIComponent(userId)}&kind=${kind}`)
        .then((r) => r.data),
  };
}
