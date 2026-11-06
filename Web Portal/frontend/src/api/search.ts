import type { ApiClient } from '../lib/api-client';
import type { TaskSearchHit } from '../lib/search-highlight';
import { allQuery, type EverythingFilters, type SavedFilters, type SearchHit, type SearchKind, type Understood } from '../lib/search-everything';

export interface SearchResults {
  /**
   * The best few tasks of the full task search: where the words are in the title (`titleRanges`)
   * and where else they matched (`matches`). `formerKeys`: keys a task had before it moved project.
   */
  tasks: TaskSearchHit[];
  projects: { id: string; code: string; name: string }[];
  users: { id: string; username: string; email: string; firstName: string; lastName: string }[];
  meetings: { id: string; title: string; projectId: string | null; snippet: string }[];
  /** 1.23: the best few notes, minutes, files and inspections (an older server sends none). */
  more?: SearchHit[];
  /** 1.23.1: the server couldn't search the tasks this time (the rest is here); absent when it could. */
  tasksUnavailable?: boolean;
  /** 1.23.6: what the reader understood ("Tasks · Overdue · MICO · Assigned to me") and how many it finds; absent when nothing was read. */
  understood?: Understood & { total: number; capped: boolean };
}

export function searchApi(client: ApiClient) {
  return {
    search: (q: string) =>
      client.get<{ data: SearchResults }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.data),
  };
}

/** The full task search's filters (GET /search/tasks). */
export interface TaskSearchParams {
  q: string;
  projectId?: string;
  /** A column category (TODO, IN_PROGRESS…). */
  status?: string;
  /** A person's id, or "me". */
  assigneeId?: string;
  /** true: finished only; false: open only. */
  done?: boolean;
  /** Include archived projects' tasks. */
  archived?: boolean;
  cursor?: string;
}

/** A page of the full task search: `total` (counted up to 1000) comes with the first page only. */
export interface TaskSearchPage {
  data: TaskSearchHit[];
  nextCursor: string | null;
  total?: number;
  totalCapped?: boolean;
}

/** GET /search/tasks's query: only what is set. */
export function taskSearchQuery(p: TaskSearchParams): string {
  const q = new URLSearchParams({ q: p.q.trim() });
  if (p.projectId) q.set('projectId', p.projectId);
  if (p.status) q.set('status', p.status);
  if (p.assigneeId) q.set('assigneeId', p.assigneeId);
  if (p.done !== undefined) q.set('done', String(p.done));
  if (p.archived) q.set('archived', 'true');
  if (p.cursor) q.set('cursor', p.cursor);
  return q.toString();
}

export function taskSearchApi(client: ApiClient) {
  return {
    search: (p: TaskSearchParams) => client.get<TaskSearchPage>(`/search/tasks?${taskSearchQuery(p)}`),
  };
}

// ── 1.23 Search everything ───────────────────────────────────────────────────────────────────────

/** A page of GET /search/all: the first one also counts each kind (up to 1000) and says what was corrected. */
export interface EverythingPage {
  data: SearchHit[];
  nextCursor: string | null;
  corrected?: { from: string; to: string }[];
  counts?: Record<SearchKind, number>;
  total?: number;
  totalCapped?: boolean;
  /** 1.23.1: the tasks couldn't be searched this time (the other kinds are here); absent when they could. */
  tasksUnavailable?: boolean;
  /** 1.23.6 (first page): what the reader understood; null when the words were searched as typed (plain). */
  understood?: Understood | null;
}

/** The AI panel's answer (POST /search/ai): an answer and the best matches, or one line saying why not. */
export type AiSearchAnswer =
  | { state: 'ok'; answer: string; hits: SearchHit[]; semantic: boolean; understood?: unknown }
  | { state: 'off' | 'limit' | 'slow' | 'failed'; message: string };

export function searchEverythingApi(client: ApiClient) {
  return {
    search: (f: EverythingFilters, cursor?: string) => client.get<EverythingPage>(`/search/all?${allQuery(f, cursor)}`),
    aiStatus: () => client.get<{ data: { ready: boolean; semantic: boolean } }>('/search/ai/status').then((r) => r.data),
    ask: (f: EverythingFilters) =>
      client
        .post<{ data: AiSearchAnswer }>('/search/ai', {
          q: f.q.trim(),
          ...(f.type ? { type: f.type } : {}),
          ...(f.projectId ? { projectId: f.projectId } : {}),
          ...(f.person ? { person: f.person } : {}),
          ...(f.from ? { from: f.from } : {}),
          ...(f.to ? { to: f.to } : {}),
          ...(f.done !== undefined ? { done: f.done } : {}),
          ...(f.archived ? { archived: true } : {}),
          // 1.23.6: the question read as the page reads it.
          ...(f.off?.length ? { off: f.off } : {}),
          ...(f.plain ? { plain: true } : {}),
        })
        .then((r) => r.data),
  };
}

// ── 1.23.6 Saved searches ────────────────────────────────────────────────────────────────────────

export interface SavedSearch {
  id: string;
  name: string;
  q: string;
  filters: SavedFilters;
  owner: { id: string; name: string };
  /** The person's own (theirs to change); else shared with a team they are on (use and pin only). */
  mine: boolean;
  shared: { projectId: string; code: string; name: string } | null;
  pinned: boolean;
  updatedAt: string;
}
export interface SavedSearchList {
  mine: SavedSearch[];
  shared: SavedSearch[];
  /** The pinned ones' ids, in the side menu's order (up to 5). */
  pinned: string[];
}
export const SAVED_SEARCHES_KEY = ['saved-searches'] as const;
export const MAX_PINS = 5;

export function savedSearchesApi(client: ApiClient) {
  const one = (id: string) => `/search/saved/${encodeURIComponent(id)}`;
  return {
    list: () => client.get<{ data: SavedSearchList }>('/search/saved').then((r) => r.data),
    create: (body: { name: string; q: string; filters: SavedFilters }) => client.post<{ data: SavedSearch }>('/search/saved', body).then((r) => r.data),
    update: (id: string, body: { name?: string; q?: string; filters?: SavedFilters }) => client.patch<{ data: SavedSearch }>(one(id), body).then((r) => r.data),
    remove: (id: string) => client.del(one(id)),
    share: (id: string, projectId: string | null) => client.put<{ data: SavedSearch }>(`${one(id)}/share`, { projectId }).then((r) => r.data),
    pin: (id: string, pinned: boolean) => client.put<{ data: SavedSearchList }>(`${one(id)}/pin`, { pinned }).then((r) => r.data),
    shareOptions: () => client.get<{ data: { id: string; code: string; name: string }[] }>('/search/saved/share-options').then((r) => r.data),
    /** How many items each finds now (for the person; kept a minute on the server). */
    counts: (ids: string[]) => client.get<{ data: Record<string, { total: number; capped: boolean }> }>(`/search/saved/counts?ids=${encodeURIComponent(ids.join(','))}`).then((r) => r.data),
  };
}
