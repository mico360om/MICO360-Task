import type { ApiClient } from '../lib/api-client';

export interface ApiComment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: string;
}

export function commentsApi(client: ApiClient) {
  return {
    list: (taskId: string) => client.get<{ data: ApiComment[] }>(`/tasks/${taskId}/comments`).then((r) => r.data),
    add: (taskId: string, body: string) => client.post<{ data: ApiComment }>(`/tasks/${taskId}/comments`, { body }).then((r) => r.data),
  };
}
