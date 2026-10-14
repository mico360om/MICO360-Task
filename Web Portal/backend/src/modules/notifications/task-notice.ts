const MAX_LENGTH = 140;

/**
 * The second line of a notification about a task: which task it is ("MICO-12 · Prepare the monthly
 * report"). Without it every row read the same — "You were assigned a task" — and could only be told
 * apart by opening each one.
 */
export function taskNoticeBody(task: { key: string; title: string | null } | null | undefined): string | null {
  if (!task) return null;
  const title = (task.title ?? '').trim();
  const line = title ? `${task.key} · ${title}` : task.key;
  return line.length > MAX_LENGTH ? `${line.slice(0, MAX_LENGTH - 1).trimEnd()}…` : line;
}
