import type { UserDigest } from './notification-digest';
import type { ReminderLogStore } from './reminder-dispatch';
import { isMuted, normalizePreferences } from './notification-preferences';

/**
 * The morning bell digest (TASK_DIGEST), from the hourly sweep that starts at 07:00 company time: each
 * person's overdue and due-today tasks, once a day.
 *
 * Review fix #28 (13 Nov 2026): the notice is sent first and only then marked as sent for the day (as
 * every other sweep does — reminder-dispatch), so a failure in between leaves it unmarked and the next
 * hourly run sends it; before, the mark came first and a blip lost that day's digest. Each person is
 * tried on their own: one failure is logged and never stops the digests of the people after them.
 */
export interface DigestDispatchDeps {
  /** The company-local day (YYYY-MM-DD): the once-a-day mark and the notice's entity id. */
  day: string;
  /** The person's notification preferences; undefined: not in the sweep's audience (nothing is written). */
  prefsOf: (userId: string) => unknown;
  store: ReminderLogStore;
  notify: (n: { userId: string; type: 'TASK_DIGEST'; title: string; body: string; entityType: 'digest'; entityId: string }) => Promise<unknown>;
  onError?: (err: unknown, userId: string) => void;
}

/** Sends the digests not yet sent today; returns how many notices went. */
export async function sendDigests(digests: UserDigest[], { day, prefsOf, store, notify, onError }: DigestDispatchDeps): Promise<number> {
  let sent = 0;
  for (const digest of digests) {
    const prefs = prefsOf(digest.userId);
    if (prefs === undefined) continue;
    // A muted digest isn't written.
    if (isMuted(normalizePreferences(prefs), 'TASK_DIGEST')) continue;
    // A per-day marker keeps the digest to once daily even as the sweep re-runs hourly.
    const dedupe = `digest:${digest.userId}:${day}`;
    try {
      if (await store.has(dedupe)) continue;
      const summary = `${digest.overdue.length} overdue · ${digest.dueToday.length} due today`;
      const items = [...digest.overdue.map((i) => `${i.key} ${i.title} (overdue, due ${i.dueDate})`), ...digest.dueToday.map((i) => `${i.key} ${i.title} (due today)`)];
      const lines = items.map((i) => `• ${i}`).join('\n');
      // In-app notification — reliable regardless of email deliverability. Nothing stored means the type is
      // suppressed for this user, so no email either. (The morning emails are the daily task emails.)
      await notify({ userId: digest.userId, type: 'TASK_DIGEST', title: `Your daily digest — ${summary}`, body: lines, entityType: 'digest', entityId: day });
      sent++;
      await store.add(dedupe);
    } catch (err) {
      // Not sent: the next hourly run tries again. Sent but not marked: logged (a rare second notice at worst).
      onError?.(err, digest.userId);
    }
  }
  return sent;
}
