/** A user's notification preferences: muted types + how early to remind before a due date. */
export interface NotificationPreferences {
  muted: string[];
  /** Minutes before a task's due date to send a "due soon" reminder; omitted = use the default. */
  reminderLeadMinutes?: number;
}

/** Upper bound on the reminder lead time (30 days) — guards against absurd stored values. */
export const MAX_REMINDER_LEAD_MINUTES = 30 * 24 * 60;

export function emptyPreferences(): NotificationPreferences {
  return { muted: [] };
}

/** Coerce arbitrary stored/request JSON into a valid preferences object. */
export function normalizePreferences(input: unknown): NotificationPreferences {
  if (!input || typeof input !== 'object') return emptyPreferences();
  const raw = input as { muted?: unknown; reminderLeadMinutes?: unknown };
  const muted = Array.isArray(raw.muted)
    ? [...new Set(raw.muted.filter((m): m is string => typeof m === 'string' && m.trim().length > 0))]
    : [];
  const lead = raw.reminderLeadMinutes;
  const out: NotificationPreferences = { muted };
  if (typeof lead === 'number' && Number.isInteger(lead) && lead >= 0 && lead <= MAX_REMINDER_LEAD_MINUTES) {
    out.reminderLeadMinutes = lead;
  }
  return out;
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
