/**
 * What sort of file an attachment is — picks its badge, and whether a picture preview is shown. A
 * plain-JavaScript copy of the web app's `lib/file-kind.ts` (shared with the Android app);
 * src/file-kind.test.js runs both over the same files, so the copies can't drift apart.
 * Kinds: 'image' | 'pdf' | 'sheet' | 'doc' | 'slides' | 'archive' | 'text' | 'other'.
 */

const BY_EXTENSION = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', avif: 'image',
  pdf: 'pdf',
  xlsx: 'sheet', xls: 'sheet', csv: 'sheet', ods: 'sheet',
  docx: 'doc', doc: 'doc', odt: 'doc', rtf: 'doc',
  pptx: 'slides', ppt: 'slides', odp: 'slides',
  zip: 'archive', rar: 'archive', '7z': 'archive', gz: 'archive', tar: 'archive',
  txt: 'text', md: 'text', log: 'text', json: 'text',
};

/**
 * The kind of file, from its type, else its name. An SVG is never shown as a picture inline: it is
 * a document that can carry script.
 */
export function fileKind(mimeType, filename) {
  const mime = (mimeType || '').toLowerCase();
  const ext = (String(filename ?? '').split('.').pop() ?? '').toLowerCase();
  if (mime === 'image/svg+xml' || ext === 'svg') return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'sheet';
  if (mime.includes('wordprocessing') || mime === 'application/msword') return 'doc';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'slides';
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('x-tar') || mime.includes('gzip')) return 'archive';
  if (mime.startsWith('text/')) return 'text';
  return Object.prototype.hasOwnProperty.call(BY_EXTENSION, ext) ? BY_EXTENSION[ext] : 'other';
}

/** The badge a file without a picture shows, as on the web. */
export const KIND_LABEL = { image: 'IMG', pdf: 'PDF', sheet: 'XLS', doc: 'DOC', slides: 'PPT', archive: 'ZIP', text: 'TXT', other: 'FILE' };

/**
 * Whether a path is one of the files the server stored: under `/uploads/`, and never climbing out of
 * it (`..`, written plainly or encoded, or a backslash). Any other page of the server is not a file.
 */
export function isUploadPath(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return false;
  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return false;
  }
  return ![url, decoded].some((u) => u.includes('..') || u.includes('\\'));
}

/**
 * Where an attachment's file is: the server keeps the path it is served at (`/uploads/<key>`), beside
 * the API (its address without `/api/v1`), as the web app builds it. Anything that isn't such a path
 * (an address elsewhere, a `javascript:` link, another page of the server) gives null: only the
 * server's own stored files are linked or shown.
 */
export function attachmentUrl(apiBase, url) {
  if (!isUploadPath(url)) return null;
  const origin = String(apiBase || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return origin ? `${origin}${url}` : null;
}
