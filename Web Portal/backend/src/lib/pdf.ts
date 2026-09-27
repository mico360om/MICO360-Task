import { PdfDocument } from './pdf-document';

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
export function toSimplePdf({ title, columns, rows }: PdfTable): Buffer {
  const doc = new PdfDocument({ title, footerLeft: title });
  doc.text(title, { bold: true, size: 16 });
  doc.text(`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`, { size: 9, color: [0.42, 0.4, 0.38], gap: 8 });
  if (columns.length > 0) {
    doc.table(
      columns.map((c) => ({ header: humanizeColumn(c) })),
      rows.map((r) => columns.map((c) => cellText(r[c]))),
    );
  }
  if (columns.length === 0 || rows.length === 0) {
    doc.spacer(6).text('No data for this report.', { color: [0.42, 0.4, 0.38], size: 9.5 });
  }
  return doc.build();
}
