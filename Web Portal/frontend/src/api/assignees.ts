import type { ApiClient } from '../lib/api-client';

export interface ApiAssignee {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

export function assigneesApi(client: ApiClient) {
  return {
    list: (taskId: string) => client.get<{ data: ApiAssignee[] }>(`/tasks/${taskId}/assignees`).then((r) => r.data),
    assign: (taskId: string, userId: string) =>
      client.post<{ data: ApiAssignee[] }>(`/tasks/${taskId}/assignees`, { userIds: [userId] }).then((r) => r.data),
    /** Assign several users in one call (the endpoint accepts a userIds array). */
    assignMany: (taskId: string, userIds: string[]) =>
      client.post<{ data: ApiAssignee[] }>(`/tasks/${taskId}/assignees`, { userIds }).then((r) => r.data),
    unassign: (taskId: string, userId: string) => client.del<void>(`/tasks/${taskId}/assignees/${userId}`),
  };
}
