/**
 * Task attachments on the phone (A4.2): list, open, upload and remove the files on a task. Pure
 * TypeScript helpers; the screen supplies the file picker and opens links.
 */

export interface ApiAttachment {
  id: string;
  taskId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** `/uploads/<key>` on the API server (or an absolute URL for external storage). */
  url: string;
  createdAt: string;
}

/** The address to open an attachment at: the API server's origin + its path. */
export function attachmentHref(apiBase: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = apiBase.replace(/\/api\/v\d+\/?$/, '').replace(/\/+$/, '');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** "532 B", "12.4 KB", "3.1 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The uploader and administrators may remove an attachment (the server enforces the same rule). */
export function canRemoveAttachment(a: Pick<ApiAttachment, 'uploadedById'>, userId: string | null, roles: string[]): boolean {
  return !!userId && (a.uploadedById === userId || roles.includes('ADMIN'));
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** The type to declare for an upload: the picker's, unless it's missing or generic, then by extension. */
export function uploadMimeType(filename: string, pickerType?: string | null): string {
  const t = (pickerType ?? '').trim().toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/** A small icon for the file type. */
export function attachmentIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf') return '📕';
  if (mimeType === 'application/zip') return '🗜️';
  if (/sheet|excel|csv/.test(mimeType)) return '📊';
  if (/presentation|powerpoint/.test(mimeType)) return '📽️';
  return '📄';
}

/** The React Native multipart part for a picked file ({ uri, name, type }). */
export function uploadPart(file: { uri: string; name: string; mimeType?: string | null }): { uri: string; name: string; type: string } {
  return { uri: file.uri, name: file.name, type: uploadMimeType(file.name, file.mimeType) };
}

/** Readable reason for a refused upload (the server's message is already plain). */
export function uploadErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? '';
  if (/not allowed|does not match/i.test(msg)) return 'This type of file can’t be attached. Try a picture, PDF, text, CSV or ZIP file.';
  if (/too large|exceeds|quota/i.test(msg)) return 'The file is too large for this task.';
  return 'Couldn’t attach the file. Check your connection and try again.';
}
