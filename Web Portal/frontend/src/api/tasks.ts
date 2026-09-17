import type { ApiClient } from '../lib/api-client';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  interval: number;
  count?: number | null;
  until?: string | null;
  weekdays?: number[];
  dayOfMonth?: number;
  /** When true the series is paused — no new occurrences are generated until resumed. */
  paused?: boolean;
}

export interface ApiTask {
  id: string;
  key: string;
  title: string;
  description: string | null;
  projectId: string;
  columnId: string;
  /** The task's Kanban stage (status), joined from its column. */
  columnCategory?: string | null;
  position: number;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  completedAt: string | null;
  boardDate?: string | null;
  /** Append-only carry-forward history (per-date boards). */
  carryForwardLog?: { from: string; to: string; at: string }[] | null;
  createdAt: string;
  updatedAt: string;
  recurrenceRule?: RecurrenceRule | null;
  /** Assignees (present on list responses; used for card avatars). */
  assignees?: { id: string; name: string }[];
  /** Aggregate counts for card badges (present on list responses). */
  counts?: { comments: number; attachments: number; checklistDone: number; checklistTotal: number };
}

export interface NewTaskInput {
  title: string;
  projectId: string;
  columnId: string;
  description?: string;
  priority?: Priority;
  dueDate?: string;
  /** Board day (YYYY-MM-DD) for per-date boards; defaults to today server-side. */
  boardDate?: string;
}

export function tasksApi(client: ApiClient) {
  return {
    list: (projectId?: string, boardDate?: string) => {
      const qs = new URLSearchParams();
      if (projectId) qs.set('projectId', projectId);
      if (boardDate) qs.set('boardDate', boardDate);
      const suffix = qs.toString();
      return client.get<{ data: ApiTask[] }>(suffix ? `/tasks?${suffix}` : '/tasks').then((r) => r.data);
    },
    mine: () => client.get<{ data: ApiTask[] }>('/tasks/mine').then((r) => r.data),
    get: (id: string) => client.get<{ data: ApiTask }>(`/tasks/${id}`).then((r) => r.data),
    create: (input: NewTaskInput) => client.post<{ data: ApiTask }>('/tasks', input).then((r) => r.data),
    update: (
      id: string,
      patch: Omit<Partial<NewTaskInput>, 'dueDate'> & {
        progress?: number;
        columnId?: string;
        dueDate?: string | null;
        recurrenceRule?: RecurrenceRule | null;
        /** 'series' applies the edit to every occurrence of a recurring task. */
        scope?: 'one' | 'series';
      },
    ) => client.put<{ data: ApiTask }>(`/tasks/${id}`, patch).then((r) => r.data),
    move: (id: string, columnId: string, position?: number) =>
      client
        .patch<{ data: ApiTask }>(`/tasks/${id}/move`, { columnId, ...(position !== undefined ? { position } : {}) })
        .then((r) => r.data),
    remove: (id: string, scope?: 'series') =>
      client.del<void>(scope ? `/tasks/${id}?scope=${scope}` : `/tasks/${id}`),
    /** Admin: run the per-date carry-forward sweep on demand. */
    runCarryForward: () => client.post<{ data: { carried: number } }>('/tasks/carry-forward', {}).then((r) => r.data),
    /** Re-sequence a column's tasks (intra-column drag reordering). */
    reorder: (columnId: string, orderedIds: string[]) =>
      client.put<{ data: { ok: boolean } }>(`/columns/${columnId}/tasks/reorder`, { orderedIds }).then((r) => r.data),
  };
}

export type TasksApi = ReturnType<typeof tasksApi>;
