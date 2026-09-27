import { matchesNormalized, normalizeForSearch } from './text-normalize';

export interface SearchableTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
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

/** A meeting plus its concatenated content (agenda + notes + decisions) for the knowledge base. */
export interface SearchableMeeting {
  id: string;
  title: string;
  projectId: string | null; // null ⇒ standalone
  organizerId: string;
  attendeeUserIds: string[];
  /** Searchable body: description + agenda item titles + note bodies + decision text. */
  content: string;
}

export interface SearchMeetingResult {
  id: string;
  title: string;
  projectId: string | null;
  /** A short excerpt around the match (or the title) for the results list. */
  snippet: string;
}

export interface SearchData {
  tasks: SearchableTask[];
  projects: SearchableProject[];
  users: SearchableUser[];
  /** Meetings + their content (agenda/notes/decisions), for the Meeting Knowledge Base. */
  meetings?: SearchableMeeting[];
}

export interface SearchResults {
  tasks: SearchableTask[];
  projects: SearchableProject[];
  users: SearchableUser[];
  meetings: SearchMeetingResult[];
}

export interface SearchScope {
  /** Project ids the caller may see; `null`/undefined = unscoped (admin). */
  allowedProjectIds?: string[] | null;
  /** The caller's own id — lets them find standalone/attended meetings beyond project scope. */
  userId?: string;
}

/** At most this many task hits are returned per search (most recently updated first). */
export const TASK_RESULT_LIMIT = 50;

/** Build a ~150-char excerpt centered on the first match, or the start of the text. */
function snippetAround(text: string, q: string, radius = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const idx = clean.toLowerCase().indexOf(q);
  if (idx < 0) return clean.slice(0, radius * 2).trim() + (clean.length > radius * 2 ? '…' : '');
  const start = Math.max(0, idx - radius);
  const end = Math.min(clean.length, idx + q.length + radius);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

/** Does a task match an (already normalised) query? Shared by the in-memory and database paths. */
export function taskMatches(task: Pick<SearchableTask, 'title' | 'key'>, normalizedQuery: string): boolean {
  return matchesNormalized(normalizedQuery, task.title, task.key);
}

/**
 * Substring search over tasks/projects/people/meetings, with one shared normaliser on both sides
 * (case, Arabic letter variants, diacritics). Tasks and projects are restricted to
 * `allowedProjectIds` when a scope is given, so a member never sees another project's work.
 * People are matched on name/username only — email is not searchable or returned.
 */
export function searchAll(query: string, data: SearchData, scope: SearchScope = {}): SearchResults {
  const q = normalizeForSearch(query);
  if (!q) return { tasks: [], projects: [], users: [], meetings: [] };
  const allowed = scope.allowedProjectIds ? new Set(scope.allowedProjectIds) : null;
  const inScope = (projectId: string) => !allowed || allowed.has(projectId);
  // A meeting is visible if the caller is an admin, can see its project, or organizes/attends it.
  const canSeeMeeting = (m: SearchableMeeting): boolean => {
    if (!allowed) return true;
    if (m.projectId && allowed.has(m.projectId)) return true;
    return !!scope.userId && (m.organizerId === scope.userId || m.attendeeUserIds.includes(scope.userId));
  };
  const rawQuery = query.trim().toLowerCase();
  return {
    tasks: data.tasks.filter((t) => inScope(t.projectId) && taskMatches(t, q)).slice(0, TASK_RESULT_LIMIT),
    projects: data.projects.filter((p) => inScope(p.id) && matchesNormalized(q, p.name, p.code)),
    users: data.users
      .filter((u) => matchesNormalized(q, `${u.firstName} ${u.lastName} ${u.username}`))
      .map(({ id, username, firstName, lastName }) => ({ id, username, firstName, lastName })),
    meetings: (data.meetings ?? [])
      .filter((m) => canSeeMeeting(m) && matchesNormalized(q, m.title, m.content))
      .map((m) => ({
        id: m.id,
        title: m.title,
        projectId: m.projectId,
        snippet: snippetAround(m.content || m.title, rawQuery),
      })),
  };
}

export interface SearchDataSource {
  getSearchData(): Promise<SearchData>;
  /**
   * Search tasks in the database for one request: scoped to the caller's projects, most recently
   * updated first, at most `limit` hits. When present it replaces `SearchData.tasks`.
   */
  searchTasks?(query: string, allowedProjectIds: string[] | null, limit: number): Promise<SearchableTask[]>;
}

/**
 * Wrap a data source with a short TTL cache + single-flight loading. On a low-resource server
 * this collapses a burst of (debounced) searches into one database read instead of reloading
 * every meeting/note per keystroke. Failed loads are not cached, so a transient DB error
 * doesn't get stuck. Per-request task search passes straight through (it is already narrow).
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
    ...(inner.searchTasks ? { searchTasks: inner.searchTasks.bind(inner) } : {}),
  };
}

export function createSearchService({ data }: { data: SearchDataSource }) {
  async function search(query: string, scope: SearchScope = {}): Promise<SearchResults> {
    const results = searchAll(query, await data.getSearchData(), scope);
    if (data.searchTasks && normalizeForSearch(query)) {
      results.tasks = await data.searchTasks(query, scope.allowedProjectIds ?? null, TASK_RESULT_LIMIT);
    }
    return results;
  }
  return { search };
}

export type SearchService = ReturnType<typeof createSearchService>;
