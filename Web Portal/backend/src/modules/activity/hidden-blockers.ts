/**
 * A blocker change in a task's activity names the other task (its key and title, recorded when the
 * blocker was added or removed). That task can be in a project the reader isn't on, so the name is
 * kept only for a reader who can open that task; anyone else sees "a blocker" (the activity wording
 * falls back to it), and the other task's id is dropped too. A dependency must not reveal a hidden
 * task, here or on the task's Blocked by / Blocks lists.
 */

const BLOCKER_ACTIONS = new Set(['BLOCKER_ADDED', 'BLOCKER_REMOVED']);
/** What names the other task: dropped for a reader who can't open it. */
const HIDDEN_FIELDS = new Set(['dependsOnTaskId', 'key', 'title']);
/** The other tasks are checked this many at a time. */
const CHECK_AT_ONCE = 10;

interface ActivityLike {
  action: string;
  meta?: unknown;
}

const otherTask = (row: ActivityLike): string | null => {
  if (!BLOCKER_ACTIONS.has(row.action) || !row.meta || typeof row.meta !== 'object') return null;
  const id = (row.meta as Record<string, unknown>).dependsOnTaskId;
  return typeof id === 'string' ? id : null;
};

export async function withoutHiddenBlockers<T extends ActivityLike>(rows: T[], canOpen: (taskId: string) => Promise<boolean>): Promise<T[]> {
  const ids = [...new Set(rows.map(otherTask).filter((id): id is string => id !== null))];
  if (!ids.length) return rows;
  const open = new Set<string>();
  for (let i = 0; i < ids.length; i += CHECK_AT_ONCE) {
    const batch = ids.slice(i, i + CHECK_AT_ONCE);
    const seen = await Promise.all(batch.map((id) => canOpen(id).catch(() => false)));
    batch.forEach((id, j) => seen[j] && open.add(id));
  }
  return rows.map((row) => {
    const id = otherTask(row);
    if (id === null || open.has(id)) return row;
    const rest = Object.fromEntries(Object.entries(row.meta as Record<string, unknown>).filter(([k]) => !HIDDEN_FIELDS.has(k)));
    return { ...row, meta: rest };
  });
}
