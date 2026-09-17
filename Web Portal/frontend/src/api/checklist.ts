import type { ApiClient } from '../lib/api-client';

export interface ApiChecklistItem {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  position: number;
}

export function checklistApi(client: ApiClient) {
  return {
    list: (taskId: string) =>
      client.get<{ data: { items: ApiChecklistItem[]; progress: number } }>(`/tasks/${taskId}/checklist`).then((r) => r.data),
    add: (taskId: string, text: string) =>
      client.post<{ data: ApiChecklistItem }>(`/tasks/${taskId}/checklist`, { text }).then((r) => r.data),
    toggle: (itemId: string, done: boolean) =>
      client.put<{ data: ApiChecklistItem }>(`/checklist/${itemId}`, { done }).then((r) => r.data),
  };
}
