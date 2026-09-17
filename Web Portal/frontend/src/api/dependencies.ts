import type { ApiClient } from '../lib/api-client';

export interface DependencyView {
  /** Task ids this task depends on (its blockers). */
  blockedBy: string[];
  /** Task ids that depend on this task (the ones it blocks). */
  blocks: string[];
}

export function dependenciesApi(client: ApiClient) {
  return {
    list: (taskId: string) => client.get<{ data: DependencyView }>(`/tasks/${taskId}/dependencies`).then((r) => r.data),
    add: (taskId: string, dependsOnTaskId: string) =>
      client.post<{ data: unknown }>(`/tasks/${taskId}/dependencies`, { dependsOnTaskId }).then((r) => r.data),
    remove: (taskId: string, dependsOnTaskId: string) =>
      client.del<void>(`/tasks/${taskId}/dependencies/${dependsOnTaskId}`),
  };
}
