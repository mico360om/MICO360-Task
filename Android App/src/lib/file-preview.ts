/**
 * A task's file shown inside the app (4d), as the website's preview (Web Portal/frontend/src/
 * components/task-drawer/attachments.tsx FilePreview): a picture as itself; text and CSV as plain
 * text (never as markup), cut at the website's length; Word, Excel and PowerPoint as their text,
 * which the server reads out of them (GET /attachments/:id/preview). A PDF has no viewer in the app
 * (that would need a new package): it opens in the phone's own viewer, as before. Pure.
 */
import { ApiError } from './api-client';
import { fileKind } from './file-kind';

export type PreviewMode = 'image' | 'text' | 'office';

/** How a file can be shown inside the app (null: it is opened or downloaded instead). */
export function previewMode(mimeType: string, filename: string): PreviewMode | null {
  const kind = fileKind(mimeType, filename);
  if (kind === 'image') return 'image';
  if (/\.(docx|xlsx|pptx)$/i.test(filename)) return 'office';
  if (kind === 'text' || (mimeType || '').toLowerCase() === 'text/csv' || /\.csv$/i.test(filename)) return 'text';
  return null;
}

/** The longest text shown (the rest is in the download) — the website's. */
export const TEXT_PREVIEW_MAX = 200_000;

/** The preview's words (the website's, checked by the test). */
export const PREVIEW_TEXT = {
  failed: 'Couldn’t load the preview. You can still download the file.',
  cut: 'Only the beginning is shown — download the file for the rest.',
  moreRows: 'Only the first rows and columns are shown — download the file for the rest.',
  noText: 'This document has no text.',
  emptySheet: 'This sheet is empty.',
  noSlideText: 'No text on this slide.',
} as const;

export type OfficePreview =
  | { kind: 'document'; paragraphs: string[]; truncated: boolean }
  | { kind: 'sheet'; sheets: { name: string; rows: string[][]; truncated: boolean }[] }
  | { kind: 'slides'; slides: { number: number; lines: string[] }[]; truncated: boolean };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const cells = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))) : []);

/** The server's Office preview, read carefully (anything else is no preview). */
export function readOfficePreview(raw: unknown): OfficePreview | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  switch (r.kind) {
    case 'document':
      return { kind: 'document', paragraphs: strings(r.paragraphs), truncated: r.truncated === true };
    case 'sheet':
      return {
        kind: 'sheet',
        sheets: (Array.isArray(r.sheets) ? r.sheets : []).map((s: Record<string, unknown> | null, i: number) => ({
          name: typeof s?.name === 'string' && s.name ? s.name : `Sheet ${i + 1}`,
          rows: (Array.isArray(s?.rows) ? s!.rows : []).map(cells),
          truncated: s?.truncated === true,
        })),
      };
    case 'slides':
      return {
        kind: 'slides',
        slides: (Array.isArray(r.slides) ? r.slides : []).map((s: Record<string, unknown> | null, i: number) => ({
          number: typeof s?.number === 'number' ? s.number : i + 1,
          lines: strings(s?.lines),
        })),
        truncated: r.truncated === true,
      };
    default:
      return null;
  }
}

/**
 * A text file's words, from this server only (`href` from serverFileHref; null: not ours — nothing
 * is fetched), cut at the website's length, within a time limit.
 */
export async function loadTextPreview(fetchImpl: typeof fetch, href: string | null, timeoutMs = 20_000): Promise<{ text: string; cut: boolean }> {
  if (!href) throw new Error('Not a file on this server.');
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(href, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    return { text: text.slice(0, TEXT_PREVIEW_MAX), cut: text.length > TEXT_PREVIEW_MAX };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Why a preview couldn't be shown: the server's reason when it gave one, and that the download still works. */
export function previewFailureText(e: unknown): string {
  if (e instanceof ApiError && e.status < 500 && e.message && !/^Request failed/.test(e.message)) return `${e.message} You can still download the file.`;
  return PREVIEW_TEXT.failed;
}
