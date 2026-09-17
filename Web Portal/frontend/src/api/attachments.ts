import type { ApiClient } from '../lib/api-client';

export interface ApiAttachment {
  id: string;
  taskId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export function attachmentsApi(client: ApiClient) {
  return {
    list: (taskId: string) =>
      client.get<{ data: ApiAttachment[] }>(`/tasks/${taskId}/attachments`).then((r) => r.data),
    upload: (taskId: string, file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return client.upload<{ data: ApiAttachment }>(`/tasks/${taskId}/attachments`, form).then((r) => r.data);
    },
    remove: (attachmentId: string) => client.del<void>(`/attachments/${attachmentId}`),
  };
}
