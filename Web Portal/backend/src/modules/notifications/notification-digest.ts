/** A task considered for the daily digest, with the users who should hear about it. */
export interface DigestTask {
  id: string;
  key: string;
  title: string;
  dueDate: Date | null;
  columnCategory: string | null;
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
  /** Map a date to its day bucket (defaults to the UTC calendar day). */
  dayKey?: (d: Date) => string;
}

const utcDayKey = (d: Date): string => d.toISOString().slice(0, 10);
const isDone = (category: string | null): boolean => category === 'DONE';

/**
 * Group each recipient's open (not-done) tasks that are overdue or due today into a per-user
 * digest. Pure and deterministic — the sweep decides who to actually email and when.
 */
export function buildDigests(tasks: DigestTask[], opts: BuildDigestOptions = {}): UserDigest[] {
  const now = opts.now ?? new Date();
  const key = opts.dayKey ?? utcDayKey;
  const today = key(now);

  const byUser = new Map<string, UserDigest>();
  const digestFor = (userId: string): UserDigest => {
    let d = byUser.get(userId);
    if (!d) { d = { userId, overdue: [], dueToday: [] }; byUser.set(userId, d); }
    return d;
  };

  for (const t of tasks) {
    if (!t.dueDate || isDone(t.columnCategory)) continue;
    const due = key(t.dueDate);
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
