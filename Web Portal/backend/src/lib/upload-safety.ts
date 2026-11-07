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

/** 1.23.7: the extensions a file's name may end in for each checked type (a JPEG may say .jpeg too). */
const EXTENSIONS_FOR_MIME: Record<string, string[]> = { 'image/jpeg': ['.jpg', '.jpeg'] };
/** The longest name kept (the column holds 191 characters). */
export const MAX_UPLOAD_NAME = 180;

/** Control characters, and the invisible ones that turn text around or hide it ("invoice‮fdp.exe"). */
const hidden = (code: number) =>
  code < 0x20 ||
  code === 0x7f ||
  code === 0x061c ||
  code === 0x180e ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x2064) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

/**
 * 1.23.7 (security review) An uploaded file's name as kept and shown: without control or direction characters
 * (so it can't pretend to end in .pdf), without path separators, at most 180 characters with its extension
 * kept. For a client's upload (`client`), the name must end in the extension of the type the file was checked
 * as, else that extension is added — "invoice.exe" sent as text/plain is kept as "invoice.exe.txt", so it is
 * never saved on anyone's computer as a program.
 */
export function safeUploadName(name: string, mimeType: string, opts: { client?: boolean } = {}): string {
  const typeExt = extensionForMime(mimeType);
  let clean = [...String(name ?? '')]
    .filter((c) => !hidden(c.codePointAt(0)!))
    .join('')
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) clean = 'file';
  if (opts.client) {
    const allowed = EXTENSIONS_FOR_MIME[mimeType.toLowerCase().split(';')[0]!.trim()] ?? [typeExt];
    if (!allowed.includes(extname(clean).toLowerCase())) clean = `${clean}${typeExt}`;
  } else if (clean === 'file') {
    clean = `file${typeExt}`;
  }
  const chars = [...clean];
  if (chars.length <= MAX_UPLOAD_NAME) return clean;
  // Too long: the start of the name, then its extension (a short one; a long "extension" is just text).
  const ext = extname(clean);
  const extChars = ext && ext.length < 20 ? [...ext] : [];
  const base = chars.slice(0, chars.length - extChars.length);
  return [...base.slice(0, MAX_UPLOAD_NAME - extChars.length), ...extChars].join('');
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

