import type { ApiClient } from '../lib/api-client';
import type { ExternalContactDraft, ExternalContactFields } from '../lib/external-contacts';

/** A person outside the company responsible for a task (one task's own copy). */
export interface ApiExternalContact extends ExternalContactFields {
  id: string;
  taskId: string;
  /** Its place in the task's list (0 first). */
  position: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export function externalContactsApi(client: ApiClient) {
  return {
    list: (taskId: string) => client.get<{ data: ApiExternalContact[] }>(`/tasks/${taskId}/external-contacts`).then((r) => r.data),
    add: (taskId: string, contact: ExternalContactDraft) =>
      client.post<{ data: ApiExternalContact }>(`/tasks/${taskId}/external-contacts`, contact).then((r) => r.data),
    /** Change the fields sent (one sent empty is cleared); the rest stay as they are. */
    update: (contactId: string, contact: ExternalContactDraft) =>
      client.put<{ data: ApiExternalContact }>(`/external-contacts/${contactId}`, contact).then((r) => r.data),
    remove: (contactId: string) => client.del<unknown>(`/external-contacts/${contactId}`),
    /** Earlier contacts on this project's tasks whose name or company has a word starting with `q` (at most 10, newest first). */
    suggest: (projectId: string, q: string) =>
      client.get<{ data: ExternalContactFields[] }>(`/projects/${projectId}/external-contacts?q=${encodeURIComponent(q)}`).then((r) => r.data),
  };
}

export type ExternalContactsApi = ReturnType<typeof externalContactsApi>;
