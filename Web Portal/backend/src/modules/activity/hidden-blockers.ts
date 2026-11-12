/**
 * A blocker change in a task's activity names the other task (its key and title, recorded when the
 * blocker was added or removed). That task can be in a project the reader isn't on, so the name is
 * kept only for a reader who can open that task; anyone else sees "a blocker" (the activity wording
 * falls back to it), and the other task's id is dropped too. A dependency must not reveal a hidden
 * task, here or on the task's Blocked by / Blocks lists.
 *
 * Duplicate Task: the same for its two lines — on a copy, the task it was duplicated from
 * (DUPLICATED_FROM); on the original, the copy made (DUPLICATED). A copy made in a project the reader
 * can't see reads "duplicated this task", without its number.
 */

/** The lines that name another task: where its id is, and what names it (dropped for a reader who can't open it). */
const LINKED: Readonly<Record<string, { idField: string; hidden: ReadonlySet<string> }>> = {
  BLOCKER_ADDED: { idField: 'dependsOnTaskId', hidden: new Set(['dependsOnTaskId', 'key', 'title']) },
  BLOCKER_REMOVED: { idField: 'dependsOnTaskId', hidden: new Set(['dependsOnTaskId', 'key', 'title']) },
  DUPLICATED_FROM: { idField: 'fromTaskId', hidden: new Set(['fromTaskId', 'fromKey']) },
  DUPLICATED: { idField: 'copyTaskId', hidden: new Set(['copyTaskId', 'copyKey']) },
};
/** The other tasks are checked this many at a time. */
const CHECK_AT_ONCE = 10;

interface ActivityLike {
  action: string;
  meta?: unknown;
}

const otherTask = (row: ActivityLike): string | null => {
  const linked = LINKED[row.action];
  if (!linked || !row.meta || typeof row.meta !== 'object') return null;
  const id = (row.meta as Record<string, unknown>)[linked.idField];
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
    const hidden = LINKED[row.action]!.hidden;
    const rest = Object.fromEntries(Object.entries(row.meta as Record<string, unknown>).filter(([k]) => !hidden.has(k)));
    return { ...row, meta: rest };
  });
}
