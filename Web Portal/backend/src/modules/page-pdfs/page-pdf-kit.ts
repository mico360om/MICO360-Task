/**
 * 1.24.3 "Download PDF" on the Workspace pages (My performance, Workload, Timeline, Calendar, Projects,
 * Kanban Board, My Tasks): the parts every one of them shares. Each is a landscape A4 document on the
 * 1.23.11 PDF standard — the company's logo in the header, the page's title, its filters in words under
 * it, "Printed … by …" and "Page N of M" in the footer — drawn "like the screen" (owner, 19 Nov).
 */
import { PdfDocument, PDF_STANDARD, type RGB } from '../../lib/pdf-document';
import { BRAND, formatDay, printedLine } from '../../lib/export-format';
import { HEALTH_TONES, OVERDUE_TONES, PRIORITY_TONES, STATUS_TONES, type Tone } from '../../lib/colour-scheme';
import { resolveBrand } from '../email/brand';
import type { PdfBrand } from '../companies/company-branding';

export const TYPE = PDF_STANDARD.type;
export const INK = '#1C1A17';
export const MUTED = '#6B6661';
export const LINE = '#D1CCC7';
export const SOFT = '#F4F3F2';
export const SURFACE = '#FFFFFF';
export const BRAND_SOFT = '#F6ECEC';
export { BRAND };

/** Who and when, for the footer, and the company's brand for the header. */
export interface PdfMeta {
  generatedAt: Date;
  timeZone: string;
  generatedBy: string | null;
  company?: PdfBrand | null;
}

/** A landscape document with the standard header: the page's title, a line under it, the filters in words. */
export function pagePdf(title: string, meta: PdfMeta, header: { subtitle?: string; filters?: string[] }): PdfDocument {
  const doc = new PdfDocument({
    orientation: 'landscape',
    title,
    runningTitle: title,
    footer: { company: meta.company?.companyName ?? resolveBrand().companyName, printed: printedLine(meta.generatedAt, meta.timeZone, meta.generatedBy) },
    palette: { brand: BRAND },
    ...(meta.company?.logo ? { logo: meta.company.logo } : {}),
  });
  const details = (header.filters ?? []).map((f) => f.trim()).filter(Boolean);
  doc.reportHeader({ title, ...(header.subtitle ? { subtitle: header.subtitle } : {}), ...(details.length ? { details: [details.join(' · ')] } : {}) });
  return doc;
}

/** "Workload 2026-11-19.pdf": the page's name and the company's day (letters, digits, spaces and dashes only). */
export function pagePdfFileName(name: string, day: string): string {
  const safe = name.normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safe || 'Export'} ${day}.pdf`;
}

/** A short note in the muted colour (an empty list, a "+N more" explanation). */
export function note(doc: PdfDocument, text: string): void {
  doc.text(text, { size: TYPE.small, color: hexRgb(MUTED), gap: 3 });
}

export function hexRgb(hex: string): RGB {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '1C1A17';
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as RGB;
}

/** A colour from the data ('#RRGGBB'), else the fallback. */
export const colourOr = (value: string | null | undefined, fallback: string): string => (value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback);

export const statusTone = (category: string | null | undefined): Tone => (STATUS_TONES[(category ?? 'TODO') as keyof typeof STATUS_TONES] ?? STATUS_TONES.TODO).light;
export const priorityTone = (p: string | null | undefined): Tone => (PRIORITY_TONES[(p ?? 'NORMAL') as keyof typeof PRIORITY_TONES] ?? PRIORITY_TONES.NORMAL).light;
export const OVERDUE = OVERDUE_TONES.light;
export const HEALTH = { ON_TRACK: HEALTH_TONES.ON_TRACK.light, AT_RISK: HEALTH_TONES.AT_RISK.light, LATE: HEALTH_TONES.LATE.light };

export const STATUS_WORD: Record<string, string> = { BACKLOG: 'Backlog', TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', REVIEW: 'Review', DONE: 'Done' };
export const PRIORITY_WORD: Record<string, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
export const PROJECT_STATUS_WORD: Record<string, string> = { PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };

/** "30 Sep" in this year, "30 Sep 2027" in another. */
export function shortDay(key: string | null | undefined, today: string): string {
  if (!key) return '';
  return formatDay(key, { year: key.slice(0, 4) !== today.slice(0, 4) });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The text's first letters for an avatar-less person or project ("Omar Said" → "OS"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase() || '?';
}

/** One line of plain text: control characters and runs of spaces become one space, at most `max` characters. */
export function plainLine(value: string, max: number): string {
  return [...value].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Short, plain filter words a page sends for its header: at most 8 lines of 160 characters, control characters out. */
export function cleanFilterWords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => plainLine(v, 160))
    .filter(Boolean)
    .slice(0, 8);
}
