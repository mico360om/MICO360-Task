import type { ApiClient } from '../lib/api-client';

export interface WatcherUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

/** Task watchers — follow a task you're not assigned to and receive its notifications. */
export function watchersApi(client: ApiClient) {
  return {
    status: (taskId: string) => client.get<{ data: { watching: boolean } }>(`/tasks/${taskId}/watch`).then((r) => r.data.watching),
    list: (taskId: string) => client.get<{ data: WatcherUser[] }>(`/tasks/${taskId}/watchers`).then((r) => r.data),
    watch: (taskId: string) => client.post<{ data: { watching: boolean; watchers: WatcherUser[] } }>(`/tasks/${taskId}/watch`).then((r) => r.data),
    unwatch: (taskId: string) => client.del<void>(`/tasks/${taskId}/watch`),
  };
}
