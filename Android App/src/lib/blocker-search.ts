import { filterTasks } from './task-picker';
import type { TaskListParams } from './resources';

/** How many tasks one blocker search asks the server for (the picker shows the best few). */
export const BLOCKER_SEARCH_LIMIT = 30;

/**
 * The server search behind "Add a blocker": this project's tasks matching the words typed (key,
 * title or description, in any spelling the server knows), most recently changed first, one page
 * — instead of loading every task of the project, all days, to filter on the phone.
 */
export function blockerSearchParams(projectId: string, query: string): TaskListParams {
  return { projectId, q: query.trim(), limit: BLOCKER_SEARCH_LIMIT, sort: 'updatedAt', order: 'desc' };
}

/**
 * While the search for what is typed now still runs, the earlier results that plainly match it
 * (key or title) — never ones the server found for words no longer typed.
 */
export function stillMatching<T extends { id: string; key: string; title: string }>(hits: T[], query: string): T[] {
  return filterTasks(hits, query, new Set(), hits.length);
}

/**
 * The search results as the picker lists them: key and title matches first, ranked as the picker
 * always has (filterTasks), then the rest the server found (in a description, or another spelling
 * of an Arabic word). Tasks that can't be picked are left out.
 */
export function rankSearchHits<T extends { id: string; key: string; title: string }>(hits: T[], query: string, exclude: Set<string>, limit: number): T[] {
  const ranked = filterTasks(hits, query, exclude, limit);
  if (ranked.length >= limit) return ranked;
  const shown = new Set(ranked.map((t) => t.id));
  const rest = hits.filter((t) => !exclude.has(t.id) && !shown.has(t.id));
  return [...ranked, ...rest].slice(0, limit);
}
