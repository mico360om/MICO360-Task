import { buildXlsx, type XlsxColumn, type XlsxKind, type XlsxValue } from '../../lib/xlsx-writer';
import { PdfDocument, type PdfRichBlock, type TableColumn } from '../../lib/pdf-document';
import type { StyledRun } from '../../lib/pdf-text';
import { BRAND, formatDateTime, formatDay, slugPart, wallClock } from '../../lib/export-format';
import type { AnswerTable, CellKind, CellValue } from './mico-ai-types';

/**
 * An answer's table as an Excel workbook or a branded PDF. Both are built from the table the server
 * stored with the answer (copied from the tool results), so every figure is exactly what was shown.
 */

export interface TableExport {
  table: AnswerTable;
  /** The question the answer was for. */
  question: string;
  /** The answer's words (a small Markdown subset). */
  text: string;
  chatTitle: string;
  generatedAt: Date;
  timeZone: string;
  generatedBy: string | null;
}

/** "**bold**" runs of one line. */
function runsOf(line: string): StyledRun[] {
  const runs: StyledRun[] = [];
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  for (const p of parts) runs.push(p.startsWith('**') && p.endsWith('**') && p.length > 4 ? { text: p.slice(2, -2), bold: true } : { text: p.replace(/\*\*/g, '') });
  return runs;
}

/** The answer's words as paragraphs and bullet items (the same small Markdown subset the page shows). */
export function answerBlocks(text: string): PdfRichBlock[] {
  const blocks: PdfRichBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', runs: runsOf(para.join(' ')) });
    para = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const item = /^(?:[-*•]\s+)(.*)$/.exec(line);
    if (!line) flush();
    else if (item) {
      flush();
      blocks.push({ kind: 'item', marker: '•', runs: runsOf(item[1]!) });
    } else para.push(line);
  }
  flush();
  return blocks;
}

const XLSX_KIND: Record<CellKind, XlsxKind> = { text: 'text', key: 'text', date: 'date', datetime: 'datetime', number: 'number', percent: 'percent', days: 'integer' };

function xlsxCell(kind: CellKind, v: CellValue): XlsxValue {
  if (v === null || v === undefined) return null;
  if ((kind === 'date' || kind === 'datetime') && typeof v === 'string') return { date: v };
  return v;
}

/** A cell as the page and the PDF show it. */
export function cellText(kind: CellKind | undefined, v: CellValue): string {
  if (v === null || v === undefined || v === '') return '';
  switch (kind) {
    case 'date':
      return formatDay(String(v));
    case 'datetime':
      return `${formatDay(String(v).slice(0, 10))} ${String(v).slice(11, 16)}`.trim();
    case 'percent':
      return `${v}%`;
    case 'days':
      return `${v} ${Number(v) === 1 ? 'day' : 'days'}`;
    default:
      return String(v);
  }
}

/** "Showing 200 of 250" when the list was capped; null when every row is there. */
export function showingLine(t: AnswerTable): string | null {
  return t.total !== undefined && t.total > t.rows.length ? `Showing ${t.rows.length} of ${t.total}` : null;
}

const generatedLine = (d: TableExport) => `Generated ${formatDateTime(d.generatedAt, d.timeZone)} (${d.timeZone})${d.generatedBy ? ` by ${d.generatedBy}` : ''}`;

/** "mico-ai-overdue-tasks-2026-10-24.xlsx" (the company day). */
export function tableFileName(d: Pick<TableExport, 'table' | 'generatedAt' | 'timeZone'>, ext: 'xlsx' | 'pdf'): string {
  return `mico-ai-${slugPart(d.table.title) || 'table'}-${wallClock(d.generatedAt, d.timeZone).slice(0, 10)}.${ext}`;
}

/** Excel: a sheet named after the table, its title, the question and when, then the rows. */
export function tableXlsx(d: TableExport): Buffer {
  const columns: XlsxColumn[] = d.table.columns.map((c) => ({ header: c.label, kind: XLSX_KIND[c.kind ?? 'text'], wrap: (c.kind ?? 'text') === 'text' }));
  const rows = d.table.rows.map((r) => r.cells.map((v, i) => xlsxCell(d.table.columns[i]?.kind ?? 'text', v)));
  const name = d.table.title.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'MICO AI';
  return buildXlsx(
    [{ name, title: d.table.title, notes: [`Question: ${d.question}`, ...(showingLine(d.table) ? [showingLine(d.table)!] : []), `From MICO AI · ${generatedLine(d)}`], columns, rows }],
    { title: d.table.title, brand: BRAND },
    d.generatedAt,
  );
}

/** PDF: the company header, the question, the answer's words, then the table. */
export function tablePdf(d: TableExport): Buffer {
  const wide = d.table.columns.length > 5;
  const doc = new PdfDocument({
    orientation: wide ? 'landscape' : 'portrait',
    title: d.table.title,
    runningTitle: `${d.table.title} · MICO AI`,
    footerLeft: `MICO360 Tasks · MICO AI · ${generatedLine(d)}`,
    palette: { brand: BRAND },
  });
  doc.reportHeader({ title: d.table.title, subtitle: 'MICO AI report', details: [generatedLine(d)] });
  doc.heading('Question', { size: 11, topGap: 0, keepWith: 30 });
  doc.text(d.question, { size: 10, gap: 6 });
  const blocks = answerBlocks(d.text);
  if (blocks.length) {
    doc.heading('Answer', { size: 11, topGap: 4, keepWith: 30 });
    doc.richBlocks(blocks, { size: 10 });
    doc.spacer(8);
  }
  const columns: TableColumn[] = d.table.columns.map((c) => ({ header: c.label, align: ['number', 'percent', 'days'].includes(c.kind ?? '') ? 'right' : 'auto' }));
  const rows = d.table.rows.map((r) => r.cells.map((v, i) => cellText(d.table.columns[i]?.kind, v)));
  const showing = showingLine(d.table);
  doc.heading(`${d.table.title} (${showing ?? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`})`, { size: 11, topGap: 4, keepWith: 60 });
  const titleCol = d.table.columns.findIndex((c) => c.key === 'title' || c.key === 'message' || c.key === 'item');
  doc.table(columns, rows, { size: 9, ...(titleCol >= 0 ? { wide: titleCol } : {}) });
  return doc.build();
}
