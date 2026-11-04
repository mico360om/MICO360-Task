import { filterTasks } from './task-picker';
import { matchesTaskNumber } from './task-number';

/**
 * The website's task picker ("Add a blocker", 1.22.3): the task whose number was typed comes first
 * — typed any way ("mico 142", "MICO142", "MICO_142", "#MICO-142"; a bare "142" is any task numbered
 * …-142, current or old) — then what filterTasks finds (keys that start with or hold the query, then
 * titles). filterTasks itself is shared with the Android app and stays as it is there.
 */
export function pickTasks<T extends { id: string; key: string; title: string; formerKeys?: string[] }>(tasks: T[], query: string, exclude: Set<string>, limit = 8): T[] {
  const byNumber = tasks.filter((t) => !exclude.has(t.id) && matchesTaskNumber(query, t.key, t.formerKeys));
  if (byNumber.length === 0) return filterTasks(tasks, query, exclude, limit);
  const rest = filterTasks(tasks, query, exclude, tasks.length).filter((t) => !byNumber.includes(t));
  return [...byNumber, ...rest].slice(0, limit);
}
