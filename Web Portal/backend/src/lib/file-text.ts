/**
 * 1.23 search: the text inside a task file, for search — PDF (lib/pdf-read-text), Word, Excel and
 * PowerPoint (lib/office-preview, read further than a preview), CSV, plain text and Markdown. Pictures,
 * and PDFs with (almost) no text (scans), are marked for AI OCR, which runs elsewhere and only when AI is
 * on. Never throws: a damaged file is FAILED.
 */
import { officePreview } from './office-preview';
import { readPdfText } from './pdf-read-text';

/** At most this many characters of a file's text are kept (about 200 KB). */
export const FILE_TEXT_MAX_CHARS = 200_000;
/** A PDF with fewer letters than this is a scan: it is read by OCR when AI is on. */
export const MIN_PDF_LETTERS = 20;

export type FileTextStatus = 'READ' | 'EMPTY' | 'NEEDS_OCR' | 'SKIPPED' | 'FAILED';
export type FileTextMethod = 'pdf' | 'office' | 'text';

export interface FileText {
  status: FileTextStatus;
  method: FileTextMethod | null;
  text: string;
  truncated: boolean;
  /** A scanned PDF's page pictures (JPEG), for OCR. */
  images: Buffer[];
  /** Why it failed (for the log; never shown as is). */
  error?: string;
}

const OFFICE = /\.(docx|xlsx|pptx)$/i;
const TEXT_NAME = /\.(txt|text|csv|tsv|md|markdown|log)$/i;
const PICTURE = /^image\/(png|jpeg|gif|webp)$/;

/** Letters of any script (digits, punctuation and marks don't count). */
export function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

const cap = (text: string): { text: string; truncated: boolean } =>
  text.length > FILE_TEXT_MAX_CHARS ? { text: text.slice(0, FILE_TEXT_MAX_CHARS), truncated: true } : { text, truncated: false };

/** Bytes as text: UTF-16 with its byte-order mark, else UTF-8 (a mark dropped). */
function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const s = buf.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function result(status: FileTextStatus, method: FileTextMethod | null, raw = '', images: Buffer[] = []): FileText {
  const { text, truncated } = cap(raw.trim());
  return { status: status === 'READ' && !text ? 'EMPTY' : status, method, text, truncated, images };
}

export function readFileText(content: Buffer, file: { filename: string; mimeType: string }, opts: { timeLimitMs?: number } = {}): FileText {
  const name = file.filename ?? '';
  const mime = (file.mimeType ?? '').toLowerCase();
  try {
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
      const pdf = readPdfText(content, { maxChars: FILE_TEXT_MAX_CHARS + 1, timeLimitMs: opts.timeLimitMs ?? 5000 });
      if (letterCount(pdf.text) < MIN_PDF_LETTERS) return { ...result('NEEDS_OCR', null), images: pdf.images, text: pdf.text.trim() };
      const out = result('READ', 'pdf', pdf.text);
      return { ...out, truncated: out.truncated || pdf.truncated };
    }
    if (OFFICE.test(name)) {
      const preview = officePreview(content, name, { paragraphs: 50_000, slides: 2000, sheets: 50, rows: 20_000, cols: 100 });
      if (!preview) return result('SKIPPED', null);
      let text = '';
      if (preview.kind === 'document') text = preview.paragraphs.join('\n');
      else if (preview.kind === 'slides') text = preview.slides.map((s) => s.lines.join('\n')).join('\n');
      else text = preview.sheets.map((s) => [s.name, ...s.rows.map((r) => r.filter(Boolean).join(' '))].filter(Boolean).join('\n')).join('\n');
      return result('READ', 'office', text);
    }
    if (mime.startsWith('text/') || TEXT_NAME.test(name)) return result('READ', 'text', decodeText(content.subarray(0, FILE_TEXT_MAX_CHARS * 4)));
    if (PICTURE.test(mime)) return result('NEEDS_OCR', null);
    return result('SKIPPED', null);
  } catch (err) {
    return { ...result('FAILED', null), error: err instanceof Error ? err.message.slice(0, 200) : 'unreadable' };
  }
}
