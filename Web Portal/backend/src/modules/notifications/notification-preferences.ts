import { cleanDeliveryPrefs, type DeliveryPrefFields } from '../notify-policy/person-prefs';

/**
 * A user's notification preferences: muted types, how early to remind before a due date, daily emails —
 * and (Notification & Scheduling centre) channels per kind, quiet hours, break-through and Pause.
 */
export interface NotificationPreferences extends DeliveryPrefFields {
  muted: string[];
  /** Minutes before a task's due date to send a "due soon" reminder; omitted = use the default. */
  reminderLeadMinutes?: number;
  /** The daily email: which parts it has and when it goes; omitted = the defaults. */
  dailyEmails?: StoredDailyEmailPrefs;
  /** The weekly management summary (for people who can see the Management page); omitted = on. */
  weeklySummary?: boolean;
}

/**
 * The daily email (1.22: one email, in parts) and when it goes (HH:MM in the person's own time zone).
 * `pending` and `completed` were the two morning emails before 1.22 and keep their names, so older
 * apps' switches still work: `pending` is the person's tasks grouped by project, `completed` the
 * "Recently completed" part.
 */
export interface DailyEmailPrefs {
  /** "Your tasks": the person's open tasks, grouped by project. */
  pending: boolean;
  /** "Recently completed": their tasks completed since the last email. */
  completed: boolean;
  time: string;
  /** "Today's schedule": their meetings and their tasks due at a time today. */
  schedule: boolean;
  /** "Overdue & urgent": their overdue and urgent tasks, at the top. */
  urgent: boolean;
  /** "In your projects": overdue and waiting-for-approval tasks of the projects they run. */
  managed: boolean;
}

/** As stored: settings saved before 1.22 have no `schedule`, `urgent` or `managed` (dailyEmailPrefs fills them in). */
export type StoredDailyEmailPrefs = Pick<DailyEmailPrefs, 'pending' | 'completed' | 'time'> & Partial<Pick<DailyEmailPrefs, 'schedule' | 'urgent' | 'managed'>>;

/** The parts, in the email's order. The email goes when at least one is on (and has something in it). */
export const DAILY_EMAIL_PARTS = ['schedule', 'urgent', 'pending', 'managed', 'completed'] as const;
export type DailyEmailPart = (typeof DAILY_EMAIL_PARTS)[number];

/** Everyone gets every part, at 06:00, until they choose otherwise. */
export const DEFAULT_DAILY_EMAILS: DailyEmailPrefs = { pending: true, completed: true, time: '06:00', schedule: true, urgent: true, managed: true };

/** Is the daily email on: any one part on. */
export function dailyEmailOn(d: DailyEmailPrefs): boolean {
  return DAILY_EMAIL_PARTS.some((part) => d[part]);
}

/**
 * Fills in the parts settings saved before 1.22 don't have, keeping their meaning: "Overdue & urgent"
 * follows the old "Pending tasks" switch (it was the task list), and the new parts are on unless both
 * old emails were off — both off means no email.
 */
function withNewParts(d: { pending: boolean; completed: boolean; time: string; schedule?: unknown; urgent?: unknown; managed?: unknown }): DailyEmailPrefs {
  const wanted = d.pending || d.completed;
  return {
    pending: d.pending,
    completed: d.completed,
    time: d.time,
    schedule: typeof d.schedule === 'boolean' ? d.schedule : wanted,
    urgent: typeof d.urgent === 'boolean' ? d.urgent : d.pending,
    managed: typeof d.managed === 'boolean' ? d.managed : wanted,
  };
}

/** A time of day as HH:MM (00:00–23:59). */
export const DAILY_EMAIL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Upper bound on the reminder lead time (30 days) — guards against absurd stored values. */
export const MAX_REMINDER_LEAD_MINUTES = 30 * 24 * 60;

export function emptyPreferences(): NotificationPreferences {
  return { muted: [] };
}

/** Coerce arbitrary stored/request JSON into a valid preferences object. */
export function normalizePreferences(input: unknown): NotificationPreferences {
  if (!input || typeof input !== 'object') return emptyPreferences();
  const raw = input as { muted?: unknown; reminderLeadMinutes?: unknown; dailyEmails?: unknown; weeklySummary?: unknown };
  const muted = Array.isArray(raw.muted)
    ? [...new Set(raw.muted.filter((m): m is string => typeof m === 'string' && m.trim().length > 0))]
    : [];
  const lead = raw.reminderLeadMinutes;
  const out: NotificationPreferences = { muted };
  if (typeof lead === 'number' && Number.isInteger(lead) && lead >= 0 && lead <= MAX_REMINDER_LEAD_MINUTES) {
    out.reminderLeadMinutes = lead;
  }
  if (raw.dailyEmails && typeof raw.dailyEmails === 'object') {
    const d = raw.dailyEmails as { pending?: unknown; completed?: unknown; time?: unknown; schedule?: unknown; urgent?: unknown; managed?: unknown };
    out.dailyEmails = withNewParts({
      ...d,
      pending: typeof d.pending === 'boolean' ? d.pending : DEFAULT_DAILY_EMAILS.pending,
      completed: typeof d.completed === 'boolean' ? d.completed : DEFAULT_DAILY_EMAILS.completed,
      time: typeof d.time === 'string' && DAILY_EMAIL_TIME.test(d.time) ? d.time : DEFAULT_DAILY_EMAILS.time,
    });
  }
  if (typeof raw.weeklySummary === 'boolean') out.weeklySummary = raw.weeklySummary;
  // Notification & Scheduling centre: the person's channels, quiet hours, break-through and Pause.
  Object.assign(out, cleanDeliveryPrefs(raw as Record<string, unknown>));
  return out;
}

/** Whether the person gets the weekly management summary: yes unless they turned it off. */
export function weeklySummaryOn(prefs: NotificationPreferences | null | undefined): boolean {
  return prefs?.weeklySummary !== false;
}

/** The daily email settings in force: the saved ones, else the defaults. */
export function dailyEmailPrefs(prefs: NotificationPreferences | null | undefined): DailyEmailPrefs {
  // Settings made before 1.22 (and not read through normalizePreferences) get their new parts here too.
  return prefs?.dailyEmails ? withNewParts(prefs.dailyEmails) : { ...DEFAULT_DAILY_EMAILS };
}

/** True when a notification of this type should be suppressed for the user. */
export function isMuted(prefs: NotificationPreferences | null | undefined, type: string): boolean {
  return !!prefs && prefs.muted.includes(type);
}

/** Persistence port for per-user notification preferences. */
export interface PreferenceStore {
  get(userId: string): Promise<NotificationPreferences>;
  set(userId: string, prefs: NotificationPreferences): Promise<NotificationPreferences>;
}
