import type { ApiClient } from '../lib/api-client';
import type { TaskSearchHit } from '../lib/search-highlight';
import { allQuery, type EverythingFilters, type SearchHit, type SearchKind } from '../lib/search-everything';

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
        })
        .then((r) => r.data),
  };
}
