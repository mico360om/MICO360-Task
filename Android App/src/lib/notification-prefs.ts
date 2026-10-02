/**
 * Notification preferences on the phone (A6.1 / A7.1) — the same choices as the web Settings page:
 * turn each kind of notification on or off, and choose when "due soon" reminders arrive. Stored on
 * the server (GET/PUT /notifications/preferences), so they apply to in-app, email and push alike.
 */

export interface NotificationPreferences {
  /** Notification types the user turned off. */
  muted: string[];
  /** Minutes before a due date to send the "due soon" reminder; absent = the default (1 day). */
  reminderLeadMinutes?: number;
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

/** Flip one type on/off, keeping everything else. */
export function toggleType(prefs: NotificationPreferences | undefined, type: string): NotificationPreferences {
  const muted = prefs?.muted ?? [];
  const next = muted.includes(type) ? muted.filter((t) => t !== type) : [...muted, type];
  return { ...(prefs ?? { muted: [] }), muted: next };
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
