import { matchesTaskNumber } from './task-number';

/**
 * Tasks matching what was typed in a task picker (e.g. "Add a blocker"): by key or title, ignoring
 * case — the task whose number it is first (typed any way: "mico 142", "MICO142", "#MICO-142"; a
 * bare "142" is any …-142 — 1.22.3), then keys that start with the query, then keys that contain it,
 * then titles. `exclude` holds tasks that can't be picked (this task, ones already linked, ones that
 * depend on it).
 */
export function filterTasks<T extends { id: string; key: string; title: string; formerKeys?: string[] }>(tasks: T[], query: string, exclude: Set<string>, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  const rank = (t: T): number => {
    if (!q) return 0;
    const key = t.key.toLowerCase();
    if (matchesTaskNumber(q, t.key, t.formerKeys)) return 0;
    if (key.startsWith(q)) return 1;
    if (key.includes(q)) return 2;
    if (t.title.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return tasks
    .filter((t) => !exclude.has(t.id))
    .map((t, i) => ({ t, i, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.t);
}
