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

export function activityApi(client: ApiClient) {
  return {
    recent: () => client.get<{ data: ApiActivity[] }>('/activity').then((r) => r.data),
    /** Activity history for a single task (newest first). */
    forTask: (taskId: string) => client.get<{ data: ApiActivity[] }>(`/tasks/${taskId}/activity`).then((r) => r.data),
  };
}
