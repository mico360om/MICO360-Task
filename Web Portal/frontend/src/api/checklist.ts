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
    /** Change an item's text. */
    rename: (itemId: string, text: string) =>
      client.put<{ data: ApiChecklistItem }>(`/checklist/${itemId}`, { text }).then((r) => r.data),
    /** Put the task's items in this order (every item id, first to last). */
    reorder: (taskId: string, orderedIds: string[]) =>
      client.put<{ data: ApiChecklistItem[] }>(`/tasks/${taskId}/checklist/reorder`, { orderedIds }).then((r) => r.data),
    remove: (itemId: string) => client.del<unknown>(`/checklist/${itemId}`),
  };
}
