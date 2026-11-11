import type { ApiClient } from '../lib/api-client';

/** 1.22.4 the Error log (System Settings → Error log, administrators only). */
/** 1.23.14 UPDATE: an update restart — the database briefly away while the server stopped or started (handled), or a request cut or held up by it. */
export type ErrorKind = 'ERROR' | 'NETWORK' | 'BLOCKED' | 'SLOW' | 'SERVER' | 'UPDATE';
export type ErrorKindFilter = 'all' | 'errors' | 'blocked' | 'slow' | 'server';
export type ErrorRange = 'today' | '7d' | '30d';

/**
 * 1.23.3: where a slow request's time went — the whole time the page waited, the server's own time and
 * its time in the database (null: not said), from the answer's Server-Timing.
 */
export interface SlowTiming {
  totalMs: number | null;
  /** 1.23.14: null when only the browser's parts were said (an answer without the server's time). */
  serverMs: number | null;
  dbMs: number | null;
  /**
   * 1.23.14 — where the time went, from the browser's own timing (ms): waiting for a free connection,
   * connecting, waiting for the first byte, downloading. Absent from older reports and servers.
   */
  queueMs?: number;
  connectMs?: number;
  waitMs?: number;
  downloadMs?: number;
}

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
  /** 1.23.3, a slow request's row: its latest occurrence's timing (null: it had none; absent from an older server). */
  timing?: SlowTiming | null;
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
  /** (b) bundles, b10: a MICO360 AI failure's ids — "MICO360 AI · correlation id … · job …" — to quote to its support. */
  ai?: string | null;
  /** 1.23.3, a slow request: where its time went (null: not said; absent from an older server). */
  timing?: SlowTiming | null;
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

/**
 * 1.23.1: the server's database self-check at its start — the database server and its settings, and
 * whether the database holds every table and column the app expects and runs its queries.
 */
export interface DatabaseCheck {
  checkedAt: string;
  ok: boolean;
  server: { product: 'MySQL' | 'MariaDB'; version: string; sqlMode: string; lowerCaseTableNames: number | null } | null;
  /** 1.23.2 'busy': couldn't be checked — the database didn't answer (a connection blip), not a failure. */
  problems: { kind: 'server' | 'table' | 'column' | 'query' | 'busy'; name: string; text: string }[];
  /**
   * "Database check: OK (MySQL 8.0.46)", "Database check: 2 problems (MariaDB 11.4.5)"; 1.23.2: "… · not in
   * strict mode: text that's too long is cut short instead of refused" when the server isn't strict.
   */
  summary: string;
  /** 1.23.2: the server refuses text too long for its column (strict mode); null: unknown. Absent from an older server. */
  strict?: boolean | null;
  /** 1.23.2: the server's connection pool size ("pool 10"); null: unknown. Absent from an older server. */
  pool?: number | null;
}

export interface ErrorLogPage {
  groups: ErrorGroup[];
  /** The next page's cursor (null: no more). */
  next: string | null;
  counts: Record<ErrorKindFilter, number>;
  /** 1.23.1: null until the check ran; absent from an older server. */
  databaseCheck?: DatabaseCheck | null;
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
      // 1.23.14 updates=1: this page knows the Update restart kind (an older page gets those rows as Server rows).
      const params = new URLSearchParams({ kind: query.kind, range: query.range, status: query.status, updates: '1' });
      if (query.q.trim()) params.set('q', query.q.trim().slice(0, 100));
      if (query.before) params.set('before', query.before);
      return client.get<{ data: ErrorLogPage }>(`/error-log?${params}`).then((r) => r.data);
    },
    detail: (id: string) => client.get<{ data: ErrorGroupDetail }>(`/error-log/${encodeURIComponent(id)}`).then((r) => r.data),
    markFixed: (id: string) => client.post<{ data: ErrorGroup }>(`/error-log/${encodeURIComponent(id)}/fixed`).then((r) => r.data),
    notFixed: (id: string) => client.del<{ data: ErrorGroup }>(`/error-log/${encodeURIComponent(id)}/fixed`).then((r) => r.data),
    /** The page opened: the administrator's previous visit ("new since your last visit"); now is kept. */
    visit: () => client.post<{ data: { previousVisitAt: string | null } }>('/error-log/visit').then((r) => r.data.previousVisitAt),
    /** 1.23.2 "Check again": the database check runs now (it may wait up to about 30 s for a busy database). */
    checkDatabase: () => client.post<{ data: DatabaseCheck }>('/error-log/database-check').then((r) => r.data),
  };
}
