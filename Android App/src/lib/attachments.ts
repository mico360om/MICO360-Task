/**
 * Task attachments on the phone (A4.2): list, open, upload and remove the files on a task. Pure
 * TypeScript helpers; the screen supplies the file picker and opens links.
 */
import { ApiError, isNetworkError } from './api-client';

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

/**
 * The address of a picture stored on this server ('/uploads/…' on the API server's origin), or
 * null for anything else: a profile photo or a project picture is never loaded from another
 * address (it would tell that address who looked, and when — 6a review).
 */
export function serverUploadHref(apiBase: string, url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/uploads/') || url.split('/').includes('..')) return null;
  return attachmentHref(apiBase, url);
}

/**
 * Is this one of the copies the file picker made in the app's cache (deleted once used, and on
 * sign-out)? Never anything else: a person's own files are never touched.
 */
export function isPickedCopy(uri: string, cacheDirectory: string | null | undefined): boolean {
  if (!cacheDirectory) return false;
  const dir = `${cacheDirectory.replace(/\/+$/, '')}/DocumentPicker/`;
  return uri.startsWith(dir) && !uri.slice(dir.length).split('/').includes('..');
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

/**
 * The types the server takes by default. The old Office formats (.doc/.xls/.ppt) aren't among them
 * — it takes only the modern, macro-free ones — so they are not labelled here either.
 */
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
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

/**
 * Why a file wasn't attached. A refusal shows the server's own reason — it is already plain (the
 * wrong type, a damaged or renamed file, the task's storage limit, an empty file). The connection
 * is blamed only when there was no answer at all.
 */
export function uploadErrorMessage(err: unknown): string {
  if (isNetworkError(err)) {
    return (err as { timedOut?: unknown }).timedOut === true
      ? 'The upload took too long. Check your connection and try again.'
      : 'You’re offline — files can be attached when you’re connected.';
  }
  if (!(err instanceof ApiError)) return 'Couldn’t attach the file. Please try again.';
  // The upload limit (or a proxy in front of the server) stops a big file before the server can explain.
  if (err.status === 413) return 'That file is too large to attach.';
  if (err.status >= 500) return 'The server couldn’t save the file. Please try again in a moment.';
  // 'ERROR' = the reply had no reason of ours (e.g. a proxy's page): only "Request failed (400)".
  return err.code !== 'ERROR' && err.message ? err.message : 'The server couldn’t accept this file.';
}
