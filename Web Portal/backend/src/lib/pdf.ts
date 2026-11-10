import { PDF_STANDARD, PdfDocument, type PdfFooter } from './pdf-document';

export interface PdfTable {
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** "completionPct" → "Completion %", "projectId" → "Project ID", "username" → "Username". */
export function humanizeColumn(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^pct$/i.test(w) ? '%' : /^id$/i.test(w) ? 'ID' : w.toLowerCase()));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Render a report as a paginated A4 PDF table: a title, then every row (the header
 * repeats on each page and cells wrap, so long reports never lose rows). Text uses
 * embedded Unicode fonts with bidi + Arabic shaping, so Arabic project and employee
 * names print correctly.
 */
export function toSimplePdf({ title, columns, rows, footer }: PdfTable & { footer?: PdfFooter }): Buffer {
  const header = columns.map((c) => ({ header: humanizeColumn(c) }));
  const cells = rows.map((r) => columns.map((c) => cellText(r[c])));
  // 1.23.10: the PDF standard — portrait unless the table can't fit across it; the title on every later page.
  const doc = new PdfDocument({ title, runningTitle: title, orientation: PdfDocument.needsLandscape(header, cells) ? 'landscape' : 'portrait', footer: footer ?? {} });
  doc.documentTitle(title);
  doc.text(`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`, { size: PDF_STANDARD.type.small, color: [0.42, 0.4, 0.38], gap: 6 });
  if (columns.length > 0) doc.table(header, cells);
  if (columns.length === 0 || rows.length === 0) {
    doc.spacer(6).text('No data for this report.', { color: [0.42, 0.4, 0.38], size: PDF_STANDARD.type.small });
  }
  return doc.build();
}
