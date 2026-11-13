import { matchesNormalized, normalizeForSearch } from './text-normalize';
import { matchesTaskNumber } from '../../lib/task-number';

export interface SearchableTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  /** Keys it had before it moved to another project ("RIG-4" for OPS-17): searching one finds it. */
  formerKeys?: string[];
  /** Its external contacts' names and companies: searching one finds it. */
  external?: string[];
}
export interface SearchableProject {
  id: string;
  code: string;
  name: string;
}
export interface SearchableUser {
  id: string;
  username: string;
  /** Never returned to clients — kept optional only so legacy fixtures still type-check. */
  email?: string;
  firstName: string;
  lastName: string;
}

export interface SearchData {
  tasks: SearchableTask[];
  projects: SearchableProject[];
  users: SearchableUser[];
}

/**
 * The top bar's tasks, projects and people. Its meetings are not here: they come from the search index
 * with the person's access read on every request (top-bar-meetings.ts; review #22/#10, 13 Nov 2026), and
 * the route adds them (GET /search → meetings).
 */
export interface SearchResults {
  tasks: SearchableTask[];
  projects: SearchableProject[];
  users: SearchableUser[];
  /**
   * 1.23.1: the task search failed this time (a database error); the other results are still here and
   * the website says "Tasks couldn't be searched just now". Absent when it worked.
   */
  tasksUnavailable?: true;
}

export interface SearchScope {
  /** Project ids the caller may see; `null`/undefined = unscoped (admin). */
  allowedProjectIds?: string[] | null;
  /** companies: the people the caller may find (colleagues; with a pick, that company's); null/absent = everyone. */
  people?: ReadonlySet<string> | null;
}

/** At most this many task hits are returned per search (most recently updated first). */
export const TASK_RESULT_LIMIT = 50;

/**
 * Does a task match an (already normalised) query — its title, key, an old key, or an external
 * contact's name or company? Or its number (now or old) however it was typed: "mico 142", "MICO142"
 * (1.22.3, lib/task-number). Shared by the in-memory and database paths.
 */
export function taskMatches(task: Pick<SearchableTask, 'title' | 'key' | 'formerKeys' | 'external'>, normalizedQuery: string): boolean {
  return matchesNormalized(normalizedQuery, task.title, task.key, ...(task.formerKeys ?? []), ...(task.external ?? [])) || matchesTaskNumber(normalizedQuery, task.key, task.formerKeys);
}

/**
 * Substring search over tasks/projects/people, with one shared normaliser on both sides (case, Arabic
 * letter variants, diacritics). Tasks and projects are restricted to `allowedProjectIds` when a scope is
 * given, so a member never sees another project's work. People are matched on name/username only —
 * email is not searchable or returned.
 */
export function searchAll(query: string, data: SearchData, scope: SearchScope = {}): SearchResults {
  const q = normalizeForSearch(query);
  if (!q) return { tasks: [], projects: [], users: [] };
  const allowed = scope.allowedProjectIds ? new Set(scope.allowedProjectIds) : null;
  const inScope = (projectId: string) => !allowed || allowed.has(projectId);
  return {
    tasks: data.tasks.filter((t) => inScope(t.projectId) && taskMatches(t, q)).slice(0, TASK_RESULT_LIMIT),
    projects: data.projects.filter((p) => inScope(p.id) && matchesNormalized(q, p.name, p.code)),
    users: data.users
      // companies: only people the caller may find (colleagues; with a pick, that company's).
      .filter((u) => (!scope.people || scope.people.has(u.id)) && matchesNormalized(q, `${u.firstName} ${u.lastName} ${u.username}`))
      .map(({ id, username, firstName, lastName }) => ({ id, username, firstName, lastName })),
  };
}

export interface SearchDataSource {
  getSearchData(): Promise<SearchData>;
}

/** The global search's task group: the best few of the full task search (task-search-engine). */
export const GLOBAL_TASK_LIMIT = 5;

/** The task search the global search uses for its tasks (task-search-engine's `search`). */
export interface GlobalTaskSearch {
  search(input: { q: string; scope: { projectIds: string[] | null }; limit: number }): Promise<{ hits: SearchableTask[] }>;
}

/**
 * Wrap a data source with a short TTL cache + single-flight loading. On a low-resource server
 * this collapses a burst of (debounced) searches into one database read instead of reloading
 * every project and person per keystroke. Failed loads are not cached, so a transient DB error
 * doesn't get stuck. Only names are kept: who may see what is applied to them on every search. Tasks
 * are not in the snapshot: they are searched per request (GlobalTaskSearch); nor are meetings
 * (top-bar-meetings.ts).
 */
export function createCachedSearchDataSource(inner: SearchDataSource, opts: { ttlMs: number; now?: () => number }): SearchDataSource {
  const now = opts.now ?? (() => Date.now());
  let cached: { at: number; data: SearchData } | null = null;
  let inflight: Promise<SearchData> | null = null;
  return {
    async getSearchData(): Promise<SearchData> {
      if (cached && now() - cached.at < opts.ttlMs) return cached.data;
      if (inflight) return inflight;
      inflight = inner.getSearchData().then(
        (data) => { cached = { at: now(), data }; inflight = null; return data; },
        (err) => { inflight = null; throw err; },
      );
      return inflight;
    },
  };
}

export interface SearchOptions {
  /** 1.23.1: the task search failed (the results say `tasksUnavailable`): told the error, once, to record it. */
  onTasksFailed?: (err: unknown) => void;
}

export function createSearchService({ data, tasks }: { data: SearchDataSource; tasks?: GlobalTaskSearch }) {
  async function search(query: string, scope: SearchScope = {}, opts: SearchOptions = {}): Promise<SearchResults> {
    const results = searchAll(query, await data.getSearchData(), scope);
    if (tasks) {
      // 1.23.1: a task search that fails (the live one did, on its database server) never takes the
      // projects and people found with it down too.
      try {
        results.tasks = normalizeForSearch(query)
          ? (await tasks.search({ q: query, scope: { projectIds: scope.allowedProjectIds ?? null }, limit: GLOBAL_TASK_LIMIT })).hits
          : [];
      } catch (err) {
        results.tasks = [];
        results.tasksUnavailable = true;
        opts.onTasksFailed?.(err);
      }
    }
    return results;
  }
  return { search };
}

export type SearchService = ReturnType<typeof createSearchService>;
