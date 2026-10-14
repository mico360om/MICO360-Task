import { extname } from 'node:path';

/**
 * Uploaded files are served from the app's own origin, so a file that a browser renders as a page
 * (.html, .svg, .xml …) would run script with the viewer's session. Two rules prevent that:
 *   1. the stored extension comes from the validated MIME type, never from the uploader's filename;
 *   2. every file is served with nosniff and a sandboxing CSP, and anything that isn't a plain
 *      raster image is sent as a download instead of being rendered.
 * Rule 2 also neutralises files stored before rule 1 existed.
 */

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

/** Raster image types that are safe to display inline (never SVG). */
const INLINE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** Storage extension for a validated MIME type; unknown types get a neutral `.bin`. */
export function extensionForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType.toLowerCase().split(';')[0]!.trim()] ?? '.bin';
}

/** Response headers for a stored upload, based on its on-disk name. */
export function uploadResponseHeaders(filePath: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    // People's files: the browser may keep a copy (and revalidate it); shared caches may not.
    'Cache-Control': 'private, no-cache',
  };
  if (!INLINE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    headers['Content-Disposition'] = 'attachment';
  }
  return headers;
}

// ---------------------------------------------------------------------------------------------
// Why an upload was refused — said to the person who chose the file, so never a raw MIME type
// ("application/x-msdownload") or a byte count ("10485760-byte limit").
// ---------------------------------------------------------------------------------------------

function readableSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(1))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function fileTooLargeMessage(maxBytes: number): string {
  return `That file is too large — the limit is ${readableSize(maxBytes)}.`;
}

export function fileTypeNotAllowedMessage(fileName: string | undefined | null): string {
  const ext = extname(fileName ?? '').toLowerCase();
  const what = ext ? `“${ext}” files` : 'This kind of file';
  return `${what} can’t be attached. Try a document, image, PDF or zip instead.`;
}

export function fileContentMismatchMessage(fileName: string | undefined | null): string {
  const name = (fileName ?? '').trim();
  const ext = extname(name).toLowerCase();
  return name && ext ? `“${name}” isn’t really a ${ext} file — it may be damaged or renamed.` : 'That file isn’t what its name says — it may be damaged or renamed.';
}

