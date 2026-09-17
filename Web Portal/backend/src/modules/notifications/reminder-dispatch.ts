import type { CreateNotificationData } from './notification-repository';
import { reminderKey } from './reminder';

/**
 * Persistence port for reminder idempotency markers. Backed by a DB table in prod so the guard
 * survives process restarts and is shared across instances (an in-memory Set would re-send every
 * still-due reminder after a redeploy, and duplicate across a multi-instance deployment).
 */
export interface ReminderLogStore {
  /** Has a reminder with this dedupe key already been recorded? */
  has(dedupeKey: string): Promise<boolean>;
  /** Record that a reminder with this dedupe key was sent. */
  add(dedupeKey: string): Promise<void>;
}

export interface DispatchRemindersDeps {
  /** Stable per-run period (e.g. yyyy-mm-dd) folded into each reminder's dedupe key. */
  period: string;
  store: ReminderLogStore;
  notify: (n: CreateNotificationData) => Promise<unknown>;
}

/**
 * Send each planned reminder at most once per period, skipping any whose marker already exists.
 * Because the store is persistent, a restart or a second instance never re-sends the same reminder.
 * Returns how many reminders were actually sent.
 */
export async function dispatchReminders(
  planned: CreateNotificationData[],
  { period, store, notify }: DispatchRemindersDeps,
): Promise<number> {
  let sent = 0;
  for (const n of planned) {
    const key = reminderKey(n, period);
    if (await store.has(key)) continue;
    await notify(n);
    await store.add(key);
    sent++;
  }
  return sent;
}
