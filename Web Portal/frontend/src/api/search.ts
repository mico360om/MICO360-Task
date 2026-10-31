import type { ApiClient } from '../lib/api-client';
import type { TaskSearchHit } from '../lib/search-highlight';

export interface SearchResults {
  /**
   * The best few tasks of the full task search: where the words are in the title (`titleRanges`)
   * and where else they matched (`matches`). `formerKeys`: keys a task had before it moved project.
   */
  tasks: TaskSearchHit[];
  projects: { id: string; code: string; name: string }[];
  users: { id: string; username: string; email: string; firstName: string; lastName: string }[];
  meetings: { id: string; title: string; projectId: string | null; snippet: string }[];
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
