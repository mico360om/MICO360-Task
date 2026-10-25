import { buildXlsx, type XlsxColumn, type XlsxKind, type XlsxValue } from '../../lib/xlsx-writer';
import { PdfDocument, TABLE_PAD_X, contentWidthOf, hexToRgb, type PdfRichBlock, type TableColumn } from '../../lib/pdf-document';
import { fitColumns, measureColumns } from '../../lib/pdf-table-layout';
import type { StyledRun } from '../../lib/pdf-text';
import { BRAND, formatDateTime, formatDay, slugPart, wallClock } from '../../lib/export-format';
import type { AnswerTable, CellKind, CellValue, SourceRef } from './mico-ai-types';

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
  /** The records the answer used, listed under its words. */
  sources?: ReadonlyArray<SourceRef>;
}

/** The whole answer for its PDF report: the question, the words, every table and the sources. */
export interface AnswerExport {
  question: string;
  text: string;
  tables: AnswerTable[];
  sources: ReadonlyArray<SourceRef>;
  chatTitle: string;
  generatedAt: Date;
  timeZone: string;
  generatedBy: string | null;
}

type Made = Pick<TableExport, 'generatedAt' | 'timeZone' | 'generatedBy'>;

/** "**bold**" runs of one paragraph (its lines joined by "\n"). */
function runsOf(text: string): StyledRun[] {
  const runs: StyledRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  for (const p of parts) runs.push(p.startsWith('**') && p.endsWith('**') && p.length > 4 ? { text: p.slice(2, -2), bold: true } : { text: p.replace(/\*\*/g, '') });
  return runs;
}

/**
 * The answer's words as paragraphs and bullet items: the same small Markdown subset the page shows,
 * laid out as the page lays it out (a line break inside a paragraph stays a line break).
 */
export function answerBlocks(text: string): PdfRichBlock[] {
  const blocks: PdfRichBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', runs: runsOf(para.join('\n')) });
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

const generatedLine = (d: Made) => `Generated ${formatDateTime(d.generatedAt, d.timeZone)} (${d.timeZone})${d.generatedBy ? ` by ${d.generatedBy}` : ''}`;

/** "Sources: RIG-14 · RIG-9 · Rig Inspection Portal", or null when the answer named none. */
function sourcesLine(d: { sources?: ReadonlyArray<Pick<SourceRef, 'label'>> }): string | null {
  const labels = (d.sources ?? []).map((s) => s.label.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return labels.length ? `Sources: ${labels.join(' · ')}` : null;
}

/** "mico-ai-overdue-tasks-2026-10-24.xlsx" (the company day). */
export function tableFileName(d: Pick<TableExport, 'table' | 'generatedAt' | 'timeZone'>, ext: 'xlsx' | 'pdf'): string {
  return `mico-ai-${slugPart(d.table.title) || 'table'}-${wallClock(d.generatedAt, d.timeZone).slice(0, 10)}.${ext}`;
}

/** "mico-ai-overdue-tasks-in-rig-inspection-2026-10-24.pdf": the chat's name (or the question), and the company day. */
export function answerFileName(d: Pick<AnswerExport, 'chatTitle' | 'question' | 'generatedAt' | 'timeZone'>): string {
  return `mico-ai-${slugPart(d.chatTitle) || slugPart(d.question) || 'answer'}-${wallClock(d.generatedAt, d.timeZone).slice(0, 10)}.pdf`;
}

/** Excel: a sheet named after the table, its title, the question, the sources and when, then the rows. */
export function tableXlsx(d: TableExport): Buffer {
  const columns: XlsxColumn[] = d.table.columns.map((c) => ({ header: c.label, kind: XLSX_KIND[c.kind ?? 'text'], wrap: (c.kind ?? 'text') === 'text' }));
  const rows = d.table.rows.map((r) => r.cells.map((v, i) => xlsxCell(d.table.columns[i]?.kind ?? 'text', v)));
  const name = d.table.title.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'MICO AI';
  const notes = [`Question: ${d.question}`, showingLine(d.table), sourcesLine(d), `From MICO AI · ${generatedLine(d)}`].filter((n): n is string => !!n);
  return buildXlsx([{ name, title: d.table.title, notes, columns, rows }], { title: d.table.title, brand: BRAND }, d.generatedAt);
}

// ── The PDF report ──────────────────────────────────────────────────────────────────────────
// One text face throughout (IBM Plex Sans, with Noto Naskh Arabic for Arabic) on a fixed scale;
// the title and the section headings use the brand's heading face, as every MICO360 PDF does.
const TYPE = { body: 10, heading: 11, note: 8.5, table: 9, tableMin: 7 } as const;
const NUMERIC_KINDS = new Set<CellKind>(['number', 'percent', 'days']);
/** Kinds whose cells read best on one line (when the width allows it). */
const ONE_LINE_KINDS = new Set<CellKind>(['key', 'date', 'datetime', 'number', 'percent', 'days']);
const MUTED = hexToRgb('#6C625F');

/** The table's columns as the PDF draws them: numbers right-aligned; dates, codes and numbers kept on one line. */
function pdfColumns(t: AnswerTable): TableColumn[] {
  return t.columns.map((c) => {
    const kind = c.kind ?? 'text';
    return { header: c.label, align: NUMERIC_KINDS.has(kind) ? 'right' : 'auto', nowrap: ONE_LINE_KINDS.has(kind) };
  });
}

/**
 * The page shape for a table: portrait when it has at most five columns and they fit across a
 * portrait page at the full table size without breaking a word; otherwise landscape. (A landscape
 * table that still doesn't fit sets its type smaller, down to 7 pt; past that, long words break
 * inside their cells. Nothing is ever cut off or drawn over the next column.)
 */
export function pageOrientation(columns: TableColumn[], rows: string[][]): 'portrait' | 'landscape' {
  if (columns.length > 5) return 'landscape';
  return fitColumns(measureColumns(columns, rows), contentWidthOf('portrait'), { size: TYPE.table, padX: TABLE_PAD_X }).fits ? 'portrait' : 'landscape';
}

/** A table's cells as the PDF shows them. */
function pdfRows(t: AnswerTable): string[][] {
  return t.rows.map((r) => t.columns.map((c, i) => cellText(c.kind, r.cells[i] ?? null)));
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const clipped = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

/**
 * A MICO AI report: the company header, the question, the answer's words and its sources, then each
 * table under its own heading (kept with its header row and first row), its header row repeated on
 * every page, its rows kept whole. Every page has the logo and the chat at the top, and "Page N of M",
 * when and by whom at the bottom. Landscape when any table needs the width (see pageOrientation).
 */
function reportPdf(r: { title: string; details: string[]; runningTitle: string; question: string; text: string; sources: string | null; tables: AnswerTable[]; made: Made }): Buffer {
  const tables = r.tables.map((t) => ({ t, columns: pdfColumns(t), rows: pdfRows(t) }));
  const doc = new PdfDocument({
    orientation: tables.some((x) => pageOrientation(x.columns, x.rows) === 'landscape') ? 'landscape' : 'portrait',
    title: r.title,
    runningTitle: r.runningTitle,
    footerLeft: `MICO360 Tasks · MICO AI report · ${generatedLine(r.made)}`,
    palette: { brand: BRAND },
  });
  doc.reportHeader({ title: r.title, subtitle: 'MICO AI report', details: r.details });

  doc.heading('Question', { size: TYPE.heading, topGap: 0, keepWith: 30 });
  doc.text(r.question.trim() || '—', { size: TYPE.body, inset: 10, bar: hexToRgb(BRAND), gap: 2 });

  const blocks = answerBlocks(r.text);
  if (blocks.length) {
    doc.heading('Answer', { size: TYPE.heading, topGap: 12, keepWith: 30 });
    blocks.forEach((b, i) => {
      // Paragraphs and lists are set apart; the items of one list sit close together.
      if (i > 0) doc.spacer(b.kind === 'item' && blocks[i - 1]!.kind === 'item' ? 2 : 6);
      doc.richBlocks([b], { size: TYPE.body });
    });
  }
  if (r.sources) {
    doc.spacer(blocks.length ? 8 : 4);
    doc.text(r.sources, { size: TYPE.note, color: MUTED });
  }

  tables.forEach(({ t, columns, rows }, i) => {
    const showing = showingLine(t);
    const titleCol = t.columns.findIndex((c) => c.key === 'title' || c.key === 'message' || c.key === 'item');
    const options = { size: TYPE.table, fit: { minSize: TYPE.tableMin }, ...(titleCol >= 0 ? { wide: titleCol } : {}) };
    // The heading stays with the table's header row and its first row (never alone at a page end).
    doc.heading(`${t.title} (${showing ?? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`})`, {
      size: TYPE.heading,
      topGap: i === 0 ? 14 : 18,
      keepWith: doc.tableHeight(columns, rows, { ...options, firstRows: 1 }) + (rows.length ? 0 : 16),
    });
    doc.table(columns, rows, options);
    if (rows.length === 0) doc.text('No rows.', { size: TYPE.note, color: MUTED, gap: 2 });
  });
  return doc.build();
}

/**
 * One table's PDF: the report with just that table, under the table's own title (the chat named
 * beneath it).
 */
export function tablePdf(d: TableExport): Buffer {
  const chat = oneLine(d.chatTitle);
  return reportPdf({
    title: d.table.title,
    details: [...(chat ? [`Chat: ${chat}`] : []), generatedLine(d)],
    runningTitle: `MICO AI · ${chat || oneLine(d.question) || d.table.title}`,
    question: d.question,
    text: d.text,
    sources: sourcesLine(d),
    tables: [d.table],
    made: d,
  });
}

/**
 * The whole answer as one PDF report, under the chat's name: the question, every word of the answer,
 * every one of its tables (each under its own heading; an empty one says so) and its sources. An
 * answer without tables (a summary of meetings) makes a report too.
 */
export function answerPdf(d: AnswerExport): Buffer {
  const title = clipped(oneLine(d.chatTitle) || oneLine(d.question), 120) || 'MICO AI answer';
  return reportPdf({
    title,
    details: [generatedLine(d)],
    runningTitle: `MICO AI · ${title}`,
    question: d.question,
    text: d.text,
    sources: sourcesLine(d),
    tables: d.tables,
    made: d,
  });
}
