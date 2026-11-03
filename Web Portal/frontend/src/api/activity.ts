import type { ApiClient } from '../lib/api-client';

export interface ApiActivity {
  id: string;
  taskId: string | null;
  projectId: string | null;
  userId: string;
  action: string;
  createdAt: string;
  /** Action details (e.g. { from, to } for a move, { assignee } for an assignment). */
  meta?: Record<string, unknown> | null;
  /** The user who performed the action (the feed's "who"). */
  actor?: { id: string; name: string } | null;
  /** The task the action was on. */
  task?: { id: string; key: string; title: string } | null;
  /** The project the action was in. */
  project?: { id: string; name: string } | null;
}

/** The Activity filters the server applies too (Completed also takes in reopenings and approvals). */
export type ActivityKind = 'CREATED' | 'MOVED' | 'COMPLETED' | 'ASSIGNED';

/** How many changes fell on a day (the site's days); days with none are left out. */
export interface ActivityDayCount {
  day: string;
  count: number;
}

/** One day's changes, newest first; `next`: where the next 100 start (null: that was all). */
export interface ActivityDayPage {
  data: ApiActivity[];
  next: string | null;
}

const withKind = (params: URLSearchParams, kind?: ActivityKind | '') => {
  if (kind) params.set('kind', kind);
  return params;
};

export function activityApi(client: ApiClient) {
  return {
    recent: () => client.get<{ data: ApiActivity[] }>('/activity').then((r) => r.data),
    /** The calendar: changes per day from `from` to `to` ('YYYY-MM-DD', both included). */
    days: (from: string, to: string, kind?: ActivityKind | '') =>
      client.get<{ data: ActivityDayCount[] }>(`/activity?${withKind(new URLSearchParams({ from, to }), kind)}`).then((r) => r.data),
    /** One day's changes, 100 at a time; `before`: the `next` of the page before. */
    day: (day: string, opts: { kind?: ActivityKind | ''; before?: string | null } = {}) => {
      const params = withKind(new URLSearchParams({ day }), opts.kind);
      if (opts.before) params.set('before', opts.before);
      return client.get<ActivityDayPage>(`/activity?${params}`);
    },
    /** Activity history for a single task (newest first). */
    forTask: (taskId: string) => client.get<{ data: ApiActivity[] }>(`/tasks/${taskId}/activity`).then((r) => r.data),
  };
}
