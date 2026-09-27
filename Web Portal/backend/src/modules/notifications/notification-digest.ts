import { dueDayKey, todayKey } from '../../lib/due-date';
import { defaultCompanyTimeZone, isTaskDone } from '../tasks/task-status';

/** A task considered for the daily digest, with the users who should hear about it. */
export interface DigestTask {
  id: string;
  key: string;
  title: string;
  dueDate: Date | null;
  columnCategory: string | null;
  /** A completed task is left out, whatever column it sits in. */
  completedAt?: Date | null;
  /** Assignees ∪ watchers — everyone who should see this task in their digest. */
  recipientIds: string[];
}

export interface DigestItem {
  key: string;
  title: string;
  dueDate: string; // yyyy-mm-dd
}

export interface UserDigest {
  userId: string;
  overdue: DigestItem[];
  dueToday: DigestItem[];
}

export interface BuildDigestOptions {
  now?: Date;
  /** Company time zone that defines "today" (defaults to COMPANY_TIMEZONE). */
  timeZone?: string;
}

/**
 * Group each recipient's open (not-done) tasks that are overdue or due today into a per-user
 * digest. Due dates are calendar days and "today" is the company-time-zone date, the same rule
 * as the board, reminders and reports. Pure and deterministic — the sweep decides who to
 * actually email and when.
 */
export function buildDigests(tasks: DigestTask[], opts: BuildDigestOptions = {}): UserDigest[] {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? defaultCompanyTimeZone();
  const today = todayKey(timeZone, now);

  const byUser = new Map<string, UserDigest>();
  const digestFor = (userId: string): UserDigest => {
    let d = byUser.get(userId);
    if (!d) { d = { userId, overdue: [], dueToday: [] }; byUser.set(userId, d); }
    return d;
  };

  for (const t of tasks) {
    if (isTaskDone(t)) continue;
    const due = dueDayKey(t.dueDate, timeZone);
    if (!due) continue;
    const bucket = due < today ? 'overdue' : due === today ? 'dueToday' : null;
    if (!bucket) continue;
    const item: DigestItem = { key: t.key, title: t.title, dueDate: due };
    for (const userId of new Set(t.recipientIds)) digestFor(userId)[bucket].push(item);
  }

  // Stable order: overdue oldest-first, then due-today; drop empty users.
  const sort = (items: DigestItem[]) => items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.key.localeCompare(b.key)));
  return [...byUser.values()]
    .map((d) => ({ userId: d.userId, overdue: sort(d.overdue), dueToday: sort(d.dueToday) }))
    .filter((d) => d.overdue.length + d.dueToday.length > 0);
}
