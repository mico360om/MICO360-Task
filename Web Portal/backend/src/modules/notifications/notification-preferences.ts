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
 * The daily email (1.22: one email, in parts; the redesign of Nov 2026 adds five) and when it goes
 * (HH:MM in the person's own time zone). `pending` and `completed` were the two morning emails before
 * 1.22 and keep their names, so older apps' switches still work: `pending` is now "Other open tasks"
 * (the person's open tasks not due soon, by project), `completed` the "Completed yesterday" part.
 */
export interface DailyEmailPrefs {
  /** "Other open tasks": the person's open tasks with no due date or due later, by project. */
  pending: boolean;
  /** "Completed yesterday": their tasks completed since the last email. */
  completed: boolean;
  time: string;
  /** "Today's meetings": their meetings today, by time. */
  schedule: boolean;
  /** "Overdue" and "Due today": their overdue tasks and those due today. */
  urgent: boolean;
  /** Overdue and waiting-for-approval tasks of the projects they run, assigned to others. */
  managed: boolean;
  /** "Today at a glance": the tiles (open, in progress, not started, overdue, done this week). */
  glance: boolean;
  /** "This week": this week's tasks done of due, and the tasks completed each day of the last week. */
  week: boolean;
  /** "By priority": their open tasks by priority. */
  priority: boolean;
  /** "Coming up": their tasks due in the next 7 days, and those waiting for a later start day. */
  comingUp: boolean;
  /** "Your projects": each project they run — completion, overdue tasks, tasks waiting for approval. */
  projects: boolean;
}

/** The parts of 1.22 (and before), as old apps and old saves know them. */
export const OLD_DAILY_EMAIL_PARTS = ['schedule', 'urgent', 'pending', 'managed', 'completed'] as const;
/** The redesign's parts: saves that don't have them fill them in from their matching old part. */
export const NEW_DAILY_EMAIL_PARTS = ['glance', 'week', 'priority', 'comingUp', 'projects'] as const;
type NewPart = (typeof NEW_DAILY_EMAIL_PARTS)[number];
/** Each new part's old part: a person who turned that one off keeps the new one off too (design call 2). */
export const NEW_PART_MATCH: Readonly<Record<NewPart, 'pending' | 'completed' | 'managed'>> = {
  glance: 'pending',
  priority: 'pending',
  comingUp: 'pending',
  week: 'completed',
  projects: 'managed',
};

/** As stored: settings saved before 1.22 have no `schedule`, `urgent` or `managed`, and before the redesign none of its parts (dailyEmailPrefs fills them in). */
export type StoredDailyEmailPrefs = Pick<DailyEmailPrefs, 'pending' | 'completed' | 'time'> & Partial<Omit<DailyEmailPrefs, 'pending' | 'completed' | 'time'>>;

/** The parts, in the email's order. The email goes when at least one is on (and has something in it). */
export const DAILY_EMAIL_PARTS = ['glance', 'week', 'priority', 'urgent', 'comingUp', 'pending', 'schedule', 'completed', 'projects', 'managed'] as const;
export type DailyEmailPart = (typeof DAILY_EMAIL_PARTS)[number];

/** Everyone gets every part, at 06:00, until they choose otherwise. */
export const DEFAULT_DAILY_EMAILS: DailyEmailPrefs = {
  pending: true,
  completed: true,
  time: '06:00',
  schedule: true,
  urgent: true,
  managed: true,
  glance: true,
  week: true,
  priority: true,
  comingUp: true,
  projects: true,
};

/** Is the daily email on: any one part on. */
export function dailyEmailOn(d: DailyEmailPrefs): boolean {
  return DAILY_EMAIL_PARTS.some((part) => d[part]);
}

const bool = (v: unknown): v is boolean => typeof v === 'boolean';

/**
 * Fills in the parts older saves don't have, keeping their meaning. 1.22: "Overdue & urgent" follows the
 * old "Pending tasks" switch (it was the task list), and the 1.22 parts are on unless both old emails
 * were off — both off means no email. The redesign: each new part follows its matching part
 * (NEW_PART_MATCH), so it is on unless the person turned that one off.
 */
function withNewParts(d: { pending: boolean; completed: boolean; time: string } & Partial<Record<Exclude<DailyEmailPart, 'pending' | 'completed'>, unknown>>): DailyEmailPrefs {
  const wanted = d.pending || d.completed;
  const old = {
    pending: d.pending,
    completed: d.completed,
    time: d.time,
    schedule: bool(d.schedule) ? d.schedule : wanted,
    urgent: bool(d.urgent) ? d.urgent : d.pending,
    managed: bool(d.managed) ? d.managed : wanted,
  };
  const added = Object.fromEntries(NEW_DAILY_EMAIL_PARTS.map((k) => [k, bool(d[k]) ? d[k] : old[NEW_PART_MATCH[k]]])) as Record<NewPart, boolean>;
  return { ...old, ...added };
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
    const d = raw.dailyEmails as Record<string, unknown>;
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
