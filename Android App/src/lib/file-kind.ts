/** What sort of file an attachment is — picks its icon, and whether a picture preview is shown. */
export type FileKind = 'image' | 'pdf' | 'sheet' | 'doc' | 'slides' | 'archive' | 'text' | 'other';

const BY_EXTENSION: Record<string, FileKind> = {
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
export function fileKind(mimeType: string, filename: string): FileKind {
  const mime = (mimeType || '').toLowerCase();
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (mime === 'image/svg+xml' || ext === 'svg') return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'sheet';
  if (mime.includes('wordprocessing') || mime === 'application/msword') return 'doc';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'slides';
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('x-tar') || mime.includes('gzip')) return 'archive';
  if (mime.startsWith('text/')) return 'text';
  return BY_EXTENSION[ext] ?? 'other';
}
