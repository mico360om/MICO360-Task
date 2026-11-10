import { buildXlsx, type XlsxColumn, type XlsxKind, type XlsxValue } from '../../lib/xlsx-writer';
import { PDF_STANDARD, PdfDocument, hexToRgb, type PdfRichBlock, type TableColumn } from '../../lib/pdf-document';
import type { StyledRun } from '../../lib/pdf-text';
import { BRAND, formatDateTime, formatDay, printedLine, slugPart, wallClock } from '../../lib/export-format';
import { resolveBrand } from '../email/brand';
import type { AnswerTable, CellKind, CellValue, SourceRef } from './mico-ai-types';
import type { PdfBrand } from '../companies/company-branding';

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
/** 1.23.10: the PDF standard's sizes (body 9.5, headings 11, notes 8, tables 8.5, never under 7.5). */
const TYPE = { body: PDF_STANDARD.type.body, heading: PDF_STANDARD.type.heading, note: PDF_STANDARD.type.small, table: PDF_STANDARD.type.table, tableMin: PDF_STANDARD.type.tableMin } as const;
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
 * The page shape for a table (1.23.10, owner: documents stay portrait): portrait while its columns
 * fit across a portrait page without breaking a word, the type going down to 7.5 pt at the least;
 * otherwise its section turns landscape. (A landscape table that still doesn't fit breaks long words
 * inside their cells. Nothing is ever cut off or drawn over the next column.)
 */
export function pageOrientation(columns: TableColumn[], rows: string[][]): 'portrait' | 'landscape' {
  return PdfDocument.needsLandscape(columns, rows) ? 'landscape' : 'portrait';
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
function reportPdf(r: { title: string; details: string[]; runningTitle: string; question: string; text: string; sources: string | null; tables: AnswerTable[]; made: Made; company?: PdfBrand | null }): Buffer {
  const tables = r.tables.map((t) => ({ t, columns: pdfColumns(t), rows: pdfRows(t), shape: pageOrientation(pdfColumns(t), pdfRows(t)) }));
  // 1.23.10: portrait, a table too wide for it turning its own section landscape — from the first
  // page when it is the first table, so the question and answer share its page (never a page 1 left
  // nearly empty); the footer: the company (its own on a site with 2+ companies, else the site's),
  // "Printed … by …" and the page.
  const doc = new PdfDocument({
    orientation: tables[0]?.shape ?? 'portrait',
    title: r.title,
    runningTitle: r.runningTitle,
    footer: { company: r.company?.companyName ?? resolveBrand().companyName, printed: printedLine(r.made.generatedAt, r.made.timeZone, r.made.generatedBy) },
    palette: { brand: BRAND },
    ...(r.company?.logo ? { logo: r.company.logo } : {}),
  });
  doc.reportHeader({ title: r.title, subtitle: 'MICO AI report', details: r.details });

  doc.section(() => {
    doc.heading('Question', { topGap: 0, keepWith: 26 });
    doc.text(r.question.trim() || '—', { size: TYPE.body, inset: 10, bar: hexToRgb(BRAND), gap: 2 });
  });

  const blocks = answerBlocks(r.text);
  if (blocks.length) {
    doc.heading('Answer', { keepWith: 26 });
    blocks.forEach((b, i) => {
      // Paragraphs and lists are set apart; the items of one list sit close together.
      if (i > 0) doc.spacer(b.kind === 'item' && blocks[i - 1]!.kind === 'item' ? 2 : 6);
      doc.richBlocks([b], { size: TYPE.body });
    });
  }
  if (r.sources) {
    doc.spacer(blocks.length ? 6 : 4);
    doc.text(r.sources, { size: TYPE.note, color: MUTED });
  }

  tables.forEach(({ t, columns, rows, shape }) => {
    const showing = showingLine(t);
    const titleCol = t.columns.findIndex((c) => c.key === 'title' || c.key === 'message' || c.key === 'item');
    const options = { size: TYPE.table, fit: { minSize: TYPE.tableMin }, ...(titleCol >= 0 ? { wide: titleCol } : {}) };
    // Each table on the page shape it needs (a new page only when the shape changes).
    doc.orient(shape);
    doc.section(() => {
      // The heading stays with the table's header row and its first rows (never alone at a page end).
      doc.heading(`${t.title} (${showing ?? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`})`, {
        topGap: PDF_STANDARD.space.xl,
        keepWith: doc.tableHeight(columns, rows, { ...options, firstRows: 2 }) + (rows.length ? 0 : 16),
      });
      doc.table(columns, rows, options);
      if (rows.length === 0) doc.text('No rows.', { size: TYPE.note, color: MUTED, gap: 2 });
    });
  });
  return doc.build();
}

/**
 * One table's PDF: the report with just that table, under the table's own title (the chat named
 * beneath it).
 */
export function tablePdf(d: TableExport, company?: PdfBrand | null): Buffer {
  const chat = oneLine(d.chatTitle);
  return reportPdf({
    company,
    title: d.table.title,
    // 1.23.10: when and by whom is in the footer ("Printed … by …").
    details: chat ? [`Chat: ${chat}`] : [],
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
export function answerPdf(d: AnswerExport, company?: PdfBrand | null): Buffer {
  const title = clipped(oneLine(d.chatTitle) || oneLine(d.question), 120) || 'MICO AI answer';
  return reportPdf({
    company,
    title,
    details: [],
    runningTitle: `MICO AI · ${title}`,
    question: d.question,
    text: d.text,
    sources: sourcesLine(d),
    tables: d.tables,
    made: d,
  });
}
