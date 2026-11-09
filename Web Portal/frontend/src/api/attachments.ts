import type { ApiClient } from '../lib/api-client';
import { noteMergedWrite } from '../lib/merged-write';

export interface ApiAttachment {
  id: string;
  taskId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
  /** 1.23.7: uploaded by a client in the Client portal (shown "From client"; an older server sends none). */
  fromClient?: boolean;
  /** 1.23.7: "Show to client" — clients of the project who may view tasks see it in the portal. */
  clientVisible?: boolean;
}

/** A Word / Excel / PowerPoint file as plain text (the server unpacks it). */
export type OfficePreview =
  | { kind: 'document'; paragraphs: string[]; truncated: boolean }
  | { kind: 'sheet'; sheets: Array<{ name: string; rows: string[][]; truncated: boolean }> }
  | { kind: 'slides'; slides: Array<{ number: number; lines: string[] }>; truncated: boolean };

export function attachmentsApi(client: ApiClient) {
  return {
    list: (taskId: string) =>
      client.get<{ data: ApiAttachment[] }>(`/tasks/${taskId}/attachments`).then((r) => r.data),
    /** Upload one file; `onProgress` hears how much has been sent (0–1). */
    upload: (taskId: string, file: File, onProgress?: (fraction: number) => void) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return client.upload<{ data: ApiAttachment }>(`/tasks/${taskId}/attachments`, form, onProgress ? { onProgress } : undefined).then((r) => (noteMergedWrite(r), r.data));
    },
    remove: (attachmentId: string) => client.del<void>(`/attachments/${attachmentId}`),
    /** 1.23.7 "Show to client" on a task's file (who runs the project, or an administrator). */
    setClientVisible: (taskId: string, attachmentId: string, visible: boolean) =>
      client.put<{ data: ApiAttachment }>(`/tasks/${taskId}/attachments/${attachmentId}/client-visible`, { visible }).then((r) => r.data),
    /** The text of a .docx / .xlsx / .pptx attachment, for previewing it in the app. */
    preview: (attachmentId: string) => client.get<{ data: OfficePreview }>(`/attachments/${attachmentId}/preview`).then((r) => r.data),
  };
}
