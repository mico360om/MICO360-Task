import type { ApiClient } from '../lib/api-client';

/** 1.22.4 the Error log (System Settings → Error log, administrators only). */
export type ErrorKind = 'ERROR' | 'NETWORK' | 'BLOCKED' | 'SLOW' | 'SERVER';
export type ErrorKindFilter = 'all' | 'errors' | 'blocked' | 'slow' | 'server';
export type ErrorRange = 'today' | '7d' | '30d';

export interface ErrorGroup {
  id: string;
  kind: ErrorKind;
  title: string;
  count: number;
  /** People affected. */
  people: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** The most common page (a route pattern), or a background job's name. */
  page: string | null;
  version: string | null;
  status: 'OPEN' | 'FIXED';
  fixedAt: string | null;
  fixedInVersion: string | null;
  reopenedAt: string | null;
}

export interface ErrorOccurrence {
  id: string;
  at: string;
  kind: ErrorKind;
  detail: string | null;
  message: string;
  stack: string | null;
  page: string | null;
  job: string | null;
  resource: string | null;
  /** A server error's database diagnosis (1.22.5): Prisma's code, the database's code and its message, values masked. */
  database?: string | null;
  value: number | null;
  count: number;
  version: string | null;
  browser: string | null;
  system: string | null;
  screen: string | null;
  signedIn: boolean;
  /** The person (name null: no longer here), or null when no one was signed in. */
  person: { id: string; name: string | null } | null;
}

export interface ErrorGroupDetail {
  group: ErrorGroup & { topFile: string | null; topLine: number | null; topFunction: string | null };
  events: ErrorOccurrence[];
}

export interface ErrorLogPage {
  groups: ErrorGroup[];
  /** The next page's cursor (null: no more). */
  next: string | null;
  counts: Record<ErrorKindFilter, number>;
}

export interface ErrorLogQuery {
  kind: ErrorKindFilter;
  range: ErrorRange;
  q: string;
  status: 'open' | 'fixed';
  before?: string | null;
}

export function errorLogApi(client: ApiClient) {
  return {
    list: (query: ErrorLogQuery) => {
      const params = new URLSearchParams({ kind: query.kind, range: query.range, status: query.status });
      if (query.q.trim()) params.set('q', query.q.trim().slice(0, 100));
      if (query.before) params.set('before', query.before);
      return client.get<{ data: ErrorLogPage }>(`/error-log?${params}`).then((r) => r.data);
    },
    detail: (id: string) => client.get<{ data: ErrorGroupDetail }>(`/error-log/${encodeURIComponent(id)}`).then((r) => r.data),
    markFixed: (id: string) => client.post<{ data: ErrorGroup }>(`/error-log/${encodeURIComponent(id)}/fixed`).then((r) => r.data),
    notFixed: (id: string) => client.del<{ data: ErrorGroup }>(`/error-log/${encodeURIComponent(id)}/fixed`).then((r) => r.data),
    /** The page opened: the administrator's previous visit ("new since your last visit"); now is kept. */
    visit: () => client.post<{ data: { previousVisitAt: string | null } }>('/error-log/visit').then((r) => r.data.previousVisitAt),
  };
}
