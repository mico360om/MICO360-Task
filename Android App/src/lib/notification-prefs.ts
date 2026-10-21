/**
 * Notification preferences on the phone (A6.1 / A7.1) — the same choices as the web Settings page:
 * turn each kind of notification on or off, and choose when "due soon" reminders arrive. Stored on
 * the server (GET/PUT /notifications/preferences), so they apply to in-app, email and push alike.
 *
 * The daily task emails (6a) are saved in the same place. The server keeps whatever a PUT leaves
 * out of them, so a switch here sends only the switches and the reminder time, and a daily email
 * change sends only that one setting: nothing the website changed meanwhile is overwritten.
 */
import { ApiError, isNetworkError } from './api-client';
import { parseTimeInput } from './meeting-form';

export interface NotificationPreferences {
  /** Notification types the user turned off. */
  muted: string[];
  /** Minutes before a due date to send the "due soon" reminder; absent = the default (1 day). */
  reminderLeadMinutes?: number;
  /** The two morning emails and when they go (servers since 1.5.0 always send them). */
  dailyEmails?: DailyEmailPrefs;
}

/** Which morning emails you get, and when (HH:MM in your own time zone). */
export interface DailyEmailPrefs {
  pending: boolean;
  completed: boolean;
  time: string;
}

/** What a PUT may carry: the switches with the reminder time, or (some of) the daily emails. */
export interface PreferencesUpdate {
  muted?: string[];
  reminderLeadMinutes?: number;
  dailyEmails?: Partial<DailyEmailPrefs>;
}

export const NOTIFICATION_TYPES: { type: string; label: string; description: string }[] = [
  { type: 'TASK_ASSIGNED', label: 'Task assignments', description: 'When a task is assigned to you' },
  { type: 'TASK_STATUS', label: 'Status changes', description: 'When one of your tasks moves column' },
  { type: 'TASK_COMMENT', label: 'Comments', description: 'New comments on tasks you’re on' },
  { type: 'MENTION', label: 'Mentions', description: 'When someone @mentions you' },
  { type: 'TASK_DUE_SOON', label: 'Due soon', description: 'A reminder shortly before a task is due' },
  { type: 'TASK_OVERDUE', label: 'Overdue', description: 'When one of your tasks becomes overdue' },
];

export const REMINDER_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: 'Default (1 day)', minutes: null },
  { label: 'At due time', minutes: 0 },
  { label: '1 hour before', minutes: 60 },
  { label: '4 hours before', minutes: 240 },
  { label: '1 day before', minutes: 1440 },
  { label: '2 days before', minutes: 2880 },
  { label: '1 week before', minutes: 10080 },
];

export function isTypeOn(prefs: NotificationPreferences | undefined, type: string): boolean {
  return !(prefs?.muted ?? []).includes(type);
}

/** Flip one type on/off, keeping the others and the reminder time (the daily emails aren't sent). */
export function toggleType(prefs: NotificationPreferences | undefined, type: string): NotificationPreferences {
  const muted = prefs?.muted ?? [];
  const next = muted.includes(type) ? muted.filter((t) => t !== type) : [...muted, type];
  return prefs?.reminderLeadMinutes !== undefined ? { muted: next, reminderLeadMinutes: prefs.reminderLeadMinutes } : { muted: next };
}

/** Set the reminder lead time; null goes back to the default. */
export function withReminderLead(prefs: NotificationPreferences | undefined, minutes: number | null): NotificationPreferences {
  const muted = prefs?.muted ?? [];
  return minutes === null ? { muted } : { muted, reminderLeadMinutes: minutes };
}

/** The label of the current reminder choice. */
export function reminderLabel(prefs: NotificationPreferences | undefined): string {
  const current = prefs?.reminderLeadMinutes ?? null;
  return REMINDER_OPTIONS.find((o) => o.minutes === current)?.label ?? `${current} minutes before`;
}

// ── Daily task emails (6a) ────────────────────────────────────────────────────

/** Everyone gets both, at 06:00, until they choose otherwise (the server's defaults). */
export const DEFAULT_DAILY_EMAILS: DailyEmailPrefs = { pending: true, completed: true, time: '06:00' };

/** The two morning emails, in the website's words. */
export const DAILY_EMAIL_ITEMS: { key: 'pending' | 'completed'; label: string; description: string; a11y: string }[] = [
  { key: 'pending', label: 'Pending tasks', description: 'Overdue, due today, upcoming and undated — with priority, status and a link to each.', a11y: 'Pending tasks email' },
  { key: 'completed', label: 'Completed yesterday', description: 'Your tasks that were completed the day before, and whether they were on time.', a11y: 'Completed yesterday email' },
];

/** The daily email settings in force: the saved ones, else the defaults. */
export function dailyEmailPrefs(prefs: NotificationPreferences | undefined): DailyEmailPrefs {
  return prefs?.dailyEmails ?? { ...DEFAULT_DAILY_EMAILS };
}

/** Does the server know the daily emails? (Since 1.5.0 it always sends them; an older one would drop the switches on a save.) */
export function hasDailyEmails(prefs: NotificationPreferences | undefined): boolean {
  return !!prefs?.dailyEmails && typeof prefs.dailyEmails === 'object';
}

/** The PUT for one daily email change: only that setting, so the server keeps the rest. */
export function dailyEmailChange(patch: Partial<DailyEmailPrefs>): PreferencesUpdate {
  return { dailyEmails: patch };
}

/** A typed sending time as HH:MM ("7", "7:30", "7.30", Arabic digits), or the website's message. */
export function readDailyEmailTime(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const r = parseTimeInput(input);
  return r.ok && r.value ? { ok: true, value: r.value } : { ok: false, error: 'Choose a time, for example 06:00.' };
}

/** What "Send me a test now" sent, in the website's words: an email with nothing in it isn't sent. */
export function dailyEmailTestSummary(r: { pending: 'sent' | 'empty'; completed: 'sent' | 'empty' }): string {
  const sent = [r.pending === 'sent' ? 'pending tasks' : null, r.completed === 'sent' ? 'completed tasks' : null].filter(Boolean);
  const parts: string[] = [];
  if (sent.length === 2) parts.push('Sent both emails: pending tasks and completed tasks.');
  else if (sent.length === 1) parts.push(`Sent the ${sent[0]} email.`);
  if (r.pending === 'empty') parts.push('You have no pending tasks, so there was no pending tasks email to send.');
  if (r.completed === 'empty') parts.push('Nothing was completed yesterday, so there was no completed tasks email to send.');
  return parts.join(' ');
}

/** Did the server give a reason of its own (not just "Request failed (400)")? */
const ownReason = (e: ApiError) => e.code !== 'ERROR' && !!e.message && !/^Request failed/.test(e.message);

/** Why a test wasn't sent: the server's reason (a minute between tests, email not set up), or plainly offline. */
export function dailyEmailTestProblem(error: unknown): string {
  if (isNetworkError(error)) return 'You’re offline — a test can be sent when you’re connected.';
  if (error instanceof ApiError && ownReason(error)) return error.message;
  return 'Couldn’t send the test. Check your connection and try again.';
}

/** Why a preference change wasn't saved (the switch goes back to what is stored). */
export function prefsSaveProblem(error: unknown): string {
  if (isNetworkError(error)) return 'You’re offline — this change can be saved when you’re connected.';
  if (error instanceof ApiError && error.status === 400 && ownReason(error)) return error.message;
  return 'Couldn’t save that change. Please try again.';
}

/**
 * The preferences after a PUT, as the server makes them: switches sent with the reminder time
 * replace both (a time left out is the default again); switches not sent keep both; daily email
 * settings sent are laid over the ones in force, and kept when not sent.
 */
export function mergePreferences(current: NotificationPreferences | undefined, body: PreferencesUpdate): NotificationPreferences {
  const cur = current ?? { muted: [] };
  const lead = body.muted !== undefined ? body.reminderLeadMinutes : (body.reminderLeadMinutes ?? cur.reminderLeadMinutes);
  const out: NotificationPreferences = { muted: body.muted ?? cur.muted, ...(lead !== undefined ? { reminderLeadMinutes: lead } : {}) };
  if (body.dailyEmails !== undefined) out.dailyEmails = { ...dailyEmailPrefs(cur), ...body.dailyEmails };
  else if (cur.dailyEmails) out.dailyEmails = cur.dailyEmails;
  return out;
}
