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

/** A meeting plus its concatenated content (agenda + notes + decisions) for the knowledge base. */
export interface SearchableMeeting {
  id: string;
  title: string;
  projectId: string | null; // null ⇒ standalone
  organizerId: string;
  attendeeUserIds: string[];
  /** Searchable body: description + agenda item titles + note bodies + decision text. */
  content: string;
  /** companies: a meeting without a project belongs to this company (null/absent: none, or it has a project). */
  companyId?: string | null;
  /** companies: what an invitee may search and see of it (description + agenda): never its notes or decisions. */
  inviteeContent?: string;
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
  /**
   * companies: the picked company (X-Company-Id). Meetings follow it as the meetings list does: its
   * projects' meetings, and the caller's own meetings filed under it (an administrator: every one).
   */
  pick?: string | null;
  /** companies: an administrator (with a pick, every meeting of that company). */
  admin?: boolean;
  /** companies: the people the caller may find (colleagues; with a pick, that company's); null/absent = everyone. */
  people?: ReadonlySet<string> | null;
  /**
   * companies: the caller's active companies. A meeting they attend whose project shares none of them
   * is an invitation: only its description and agenda are searched and shown. Absent: no such rule.
   */
  companyIds?: readonly string[] | null;
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

/**
 * Does a task match an (already normalised) query — its title, key, an old key, or an external
 * contact's name or company? Or its number (now or old) however it was typed: "mico 142", "MICO142"
 * (1.22.3, lib/task-number). Shared by the in-memory and database paths.
 */
export function taskMatches(task: Pick<SearchableTask, 'title' | 'key' | 'formerKeys' | 'external'>, normalizedQuery: string): boolean {
  return matchesNormalized(normalizedQuery, task.title, task.key, ...(task.formerKeys ?? []), ...(task.external ?? [])) || matchesTaskNumber(normalizedQuery, task.key, task.formerKeys);
}

/**
 * Substring search over tasks/projects/people/meetings, with one shared normaliser on both sides
 * (case, Arabic letter variants, diacritics). Tasks and projects are restricted to
 * `allowedProjectIds` when a scope is given, so a member never sees another project's work.
 * People are matched on name/username only — email is not searchable or returned.
 */
/**
 * `projectCompanies` (companies): each project's active companies, read for this request (access is
 * never cached); without it no company rule applies to meetings (older sources, unit tests).
 */
export function searchAll(query: string, data: SearchData, scope: SearchScope = {}, projectCompanies?: ReadonlyMap<string, readonly string[]> | null): SearchResults {
  const q = normalizeForSearch(query);
  if (!q) return { tasks: [], projects: [], users: [], meetings: [] };
  const allowed = scope.allowedProjectIds ? new Set(scope.allowedProjectIds) : null;
  const inScope = (projectId: string) => !allowed || allowed.has(projectId);
  const own = (m: SearchableMeeting) => !!scope.userId && (m.organizerId === scope.userId || m.attendeeUserIds.includes(scope.userId));
  // companies: a meeting's companies — its project's active ones, or (no project) its own.
  const companiesOf = (m: SearchableMeeting): readonly string[] | null =>
    !projectCompanies ? null : m.projectId ? (projectCompanies.get(m.projectId) ?? []) : m.companyId ? [m.companyId] : [];
  // companies: a picked company keeps the meetings filed under it (its projects', or its own).
  const inPick = (m: SearchableMeeting) => {
    const ids = companiesOf(m);
    return !scope.pick || !ids || ids.includes(scope.pick);
  };
  // A meeting is visible if the caller is an admin, can see its project, or organizes/attends it.
  const canSeeMeeting = (m: SearchableMeeting): boolean => {
    if (!allowed) return true;
    if (m.projectId && allowed.has(m.projectId)) return true;
    if (scope.pick && scope.admin) return inPick(m);
    return own(m) && inPick(m);
  };
  // companies: an invitee (attends a meeting whose project shares none of their companies) sees no notes or decisions.
  const mine = scope.companyIds ? new Set(scope.companyIds) : null;
  const invited = (m: SearchableMeeting) => {
    const ids = companiesOf(m);
    return !!mine && !!m.projectId && !!ids && !(allowed && allowed.has(m.projectId)) && !ids.some((c) => mine.has(c));
  };
  const contentOf = (m: SearchableMeeting) => (invited(m) ? (m.inviteeContent ?? '') : m.content);
  const rawQuery = query.trim().toLowerCase();
  return {
    tasks: data.tasks.filter((t) => inScope(t.projectId) && taskMatches(t, q)).slice(0, TASK_RESULT_LIMIT),
    projects: data.projects.filter((p) => inScope(p.id) && matchesNormalized(q, p.name, p.code)),
    users: data.users
      // companies: only people the caller may find (colleagues; with a pick, that company's).
      .filter((u) => (!scope.people || scope.people.has(u.id)) && matchesNormalized(q, `${u.firstName} ${u.lastName} ${u.username}`))
      .map(({ id, username, firstName, lastName }) => ({ id, username, firstName, lastName })),
    meetings: (data.meetings ?? [])
      .filter((m) => canSeeMeeting(m) && matchesNormalized(q, m.title, contentOf(m)))
      .map((m) => ({
        id: m.id,
        title: m.title,
        projectId: m.projectId,
        snippet: snippetAround(contentOf(m) || m.title, rawQuery),
      })),
  };
}

export interface SearchDataSource {
  getSearchData(): Promise<SearchData>;
  /** companies: each project's active companies — read on every search, never from the cached snapshot. */
  projectCompanies?(): Promise<Map<string, string[]>>;
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
 * every meeting/note per keystroke. Failed loads are not cached, so a transient DB error
 * doesn't get stuck. Tasks are not in the snapshot: they are searched per request (GlobalTaskSearch).
 */
export function createCachedSearchDataSource(inner: SearchDataSource, opts: { ttlMs: number; now?: () => number }): SearchDataSource {
  const now = opts.now ?? (() => Date.now());
  let cached: { at: number; data: SearchData } | null = null;
  let inflight: Promise<SearchData> | null = null;
  return {
    // companies: who belongs where is access — passed through, never cached.
    ...(inner.projectCompanies ? { projectCompanies: () => inner.projectCompanies!() } : {}),
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

export function createSearchService({ data, tasks }: { data: SearchDataSource; tasks?: GlobalTaskSearch }) {
  async function search(query: string, scope: SearchScope = {}): Promise<SearchResults> {
    const [snapshot, projectCompanies] = await Promise.all([data.getSearchData(), data.projectCompanies ? data.projectCompanies() : Promise.resolve(null)]);
    const results = searchAll(query, snapshot, scope, projectCompanies);
    if (tasks) {
      results.tasks = normalizeForSearch(query)
        ? (await tasks.search({ q: query, scope: { projectIds: scope.allowedProjectIds ?? null }, limit: GLOBAL_TASK_LIMIT })).hits
        : [];
    }
    return results;
  }
  return { search };
}

export type SearchService = ReturnType<typeof createSearchService>;
