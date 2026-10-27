/** A user's notification preferences: muted types, how early to remind before a due date, daily emails. */
export interface NotificationPreferences {
  muted: string[];
  /** Minutes before a task's due date to send a "due soon" reminder; omitted = use the default. */
  reminderLeadMinutes?: number;
  /** The two morning emails (pending tasks, completed yesterday); omitted = the defaults. */
  dailyEmails?: DailyEmailPrefs;
  /** The weekly management summary (for people who can see the Management page); omitted = on. */
  weeklySummary?: boolean;
}

/** Which morning emails someone gets, and when (HH:MM in their own time zone). */
export interface DailyEmailPrefs {
  pending: boolean;
  completed: boolean;
  time: string;
}

/** Everyone gets both, at 06:00, until they choose otherwise. */
export const DEFAULT_DAILY_EMAILS: DailyEmailPrefs = { pending: true, completed: true, time: '06:00' };
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
    const d = raw.dailyEmails as { pending?: unknown; completed?: unknown; time?: unknown };
    out.dailyEmails = {
      pending: typeof d.pending === 'boolean' ? d.pending : DEFAULT_DAILY_EMAILS.pending,
      completed: typeof d.completed === 'boolean' ? d.completed : DEFAULT_DAILY_EMAILS.completed,
      time: typeof d.time === 'string' && DAILY_EMAIL_TIME.test(d.time) ? d.time : DEFAULT_DAILY_EMAILS.time,
    };
  }
  if (typeof raw.weeklySummary === 'boolean') out.weeklySummary = raw.weeklySummary;
  return out;
}

/** Whether the person gets the weekly management summary: yes unless they turned it off. */
export function weeklySummaryOn(prefs: NotificationPreferences | null | undefined): boolean {
  return prefs?.weeklySummary !== false;
}

/** The daily email settings in force: the saved ones, else the defaults. */
export function dailyEmailPrefs(prefs: NotificationPreferences | null | undefined): DailyEmailPrefs {
  return prefs?.dailyEmails ?? { ...DEFAULT_DAILY_EMAILS };
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
