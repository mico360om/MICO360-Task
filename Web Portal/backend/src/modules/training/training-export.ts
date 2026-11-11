/**
 * The Training Center's Reports page as files (owner request: participation, completion, quiz results,
 * overdue, certificates expiring): an Excel workbook with a sheet each, and a PDF in the 1.23.11 PDF
 * standard. Both say whose people they cover (all, the Training manager's companies, the project
 * manager's teams), the filters and who printed them.
 */
import { PdfDocument, PDF_STANDARD, type RGB, type StatTile, type TableColumn } from '../../lib/pdf-document';
import { buildXlsx, type XlsxColumn, type XlsxSheet, type XlsxValue } from '../../lib/xlsx-writer';
import { BRAND, formatDay, printedLine } from '../../lib/export-format';
import { zonedDayKey } from '../../lib/due-date';
import { resolveBrand } from '../email/brand';
import type { ReportBy, ReportRow, TrainingReport } from './training-types';

export interface ReportFileMeta {
  generatedBy: string | null;
  timeZone: string;
  now?: Date;
  /** Lines saying the filters ("Course: Tasks basics", "1 Oct 2026 – 31 Oct 2026"). */
  filters: string[];
  company?: { companyName: string | null; logo: Buffer | null } | null;
}

const BY_LABEL: Record<ReportBy, string> = { course: 'Course', person: 'Person', department: 'Department', role: 'Role', company: 'Company', project: 'Project' };
const SCOPE_LABEL: Record<TrainingReport['scope'], string> = { ALL: 'All people', COMPANIES: 'People in your companies', TEAM: 'Your projects’ teams' };
const MUTED: RGB = [0.42, 0.4, 0.38];
const TITLE = 'Learning Hub report';

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
const expiresDay = (iso: string, timeZone: string) => zonedDayKey(new Date(iso), timeZone);

/** "Learning Hub report by course 2026-11-11.xlsx" */
export function trainingReportFileName(r: Pick<TrainingReport, 'by'>, ext: 'pdf' | 'xlsx', today: string): string {
  return `${TITLE} by ${r.by} ${today}.${ext}`;
}

const SUMMARY_HEADERS = ['People', 'Assigned', 'Started', 'Completed', 'Overdue', 'Completion rate', 'Average score'] as const;
const summaryValues = (r: ReportRow): XlsxValue[] => [r.people, r.assigned, r.started, r.completed, r.overdue, r.completionRate, r.averageScore];

/** The report as an Excel workbook: Summary, Overdue, Certificates expiring, Quizzes. */
export function buildTrainingReportXlsx(r: TrainingReport, meta: ReportFileMeta): Buffer {
  const now = meta.now ?? new Date();
  const notes = [`By ${BY_LABEL[r.by].toLowerCase()} · ${SCOPE_LABEL[r.scope]}`, ...meta.filters, printedLine(now, meta.timeZone, meta.generatedBy)];
  const summary: XlsxSheet = {
    name: 'Summary',
    title: TITLE,
    notes,
    columns: [
      { header: BY_LABEL[r.by] },
      ...SUMMARY_HEADERS.slice(0, 5).map((header): XlsxColumn => ({ header, kind: 'integer' })),
      { header: 'Completion rate', kind: 'percent' },
      { header: 'Average score', kind: 'percent' },
    ],
    rows: [...r.rows.map((row) => [row.label, ...summaryValues(row)]), ...(r.rows.length ? [[r.totals.label, ...summaryValues(r.totals)]] : [])],
  };
  const overdue: XlsxSheet = {
    name: 'Overdue',
    title: 'Overdue training',
    notes,
    columns: [{ header: 'Name' }, { header: 'Course' }, { header: 'Due', kind: 'date' }, { header: 'Days late', kind: 'integer' }, { header: 'Mandatory' }, { header: 'Client' }],
    rows: r.overdue.map((o): XlsxValue[] => [o.name, o.courseTitle, { date: o.dueDay }, o.daysLate, yesNo(o.mandatory), yesNo(o.client)]),
  };
  const expiring: XlsxSheet = {
    name: 'Certificates expiring',
    title: 'Certificates expiring',
    notes,
    columns: [{ header: 'Name' }, { header: 'Course' }, { header: 'Expires', kind: 'date' }],
    rows: r.expiring.map((e): XlsxValue[] => [e.name, e.courseTitle, { date: expiresDay(e.expiresAt, meta.timeZone) }]),
  };
  const quizzes: XlsxSheet = {
    name: 'Quizzes',
    title: 'Quizzes',
    notes,
    columns: [{ header: 'Course' }, { header: 'Quiz' }, { header: 'Attempts', kind: 'integer' }, { header: 'Pass rate', kind: 'percent' }, { header: 'Average score', kind: 'percent' }],
    rows: r.quizzes.map((q): XlsxValue[] => [q.courseTitle, q.title, q.attempts, q.passRate, q.averageScore]),
  };
  return buildXlsx([summary, overdue, expiring, quizzes], { title: TITLE, brand: BRAND }, now);
}

/** A table, turned landscape when it can't fit across a portrait page; or a plain line when there is nothing. */
function tableOrNote(doc: PdfDocument, heading: string, cols: TableColumn[], rows: string[][], none: string): void {
  doc.heading(heading, { topGap: PDF_STANDARD.space.l, keepWith: rows.length ? doc.tableHeight(cols, rows, { firstRows: 2 }) : 20 });
  if (rows.length === 0) {
    doc.text(none, { size: PDF_STANDARD.type.small, color: MUTED });
    return;
  }
  const wide = PdfDocument.needsLandscape(cols, rows);
  if (wide) doc.orient('landscape');
  doc.table(cols, rows);
  if (wide) doc.orient('portrait');
}

/** The report as a PDF: the totals, the table by the chosen grouping, then overdue, expiring and quizzes. */
export function buildTrainingReportPdf(r: TrainingReport, meta: ReportFileMeta): Buffer {
  const now = meta.now ?? new Date();
  const doc = new PdfDocument({
    title: TITLE,
    runningTitle: TITLE,
    footer: { company: meta.company?.companyName ?? resolveBrand().companyName, printed: printedLine(now, meta.timeZone, meta.generatedBy) },
    palette: { brand: BRAND },
    ...(meta.company?.logo ? { logo: meta.company.logo } : {}),
  });
  doc.reportHeader({ title: TITLE, subtitle: `By ${BY_LABEL[r.by].toLowerCase()} · ${SCOPE_LABEL[r.scope]}`, details: meta.filters });

  const t = r.totals;
  const tiles: StatTile[] = [
    { label: 'People', value: String(t.people), note: `${t.started} started` },
    { label: 'Completed', value: String(t.completed), note: `Completion rate ${pct(t.completionRate)}`, tone: 'success' },
    { label: 'Overdue', value: String(t.overdue), tone: t.overdue > 0 ? 'danger' : 'muted' },
    { label: 'Average score', value: pct(t.averageScore), tone: 'brand' },
  ];
  doc.statTiles(tiles);

  const byCols: TableColumn[] = [{ header: BY_LABEL[r.by] }, ...SUMMARY_HEADERS.map((header): TableColumn => ({ header, align: 'right', nowrap: true }))];
  const line = (row: ReportRow) => [row.label, String(row.people), String(row.assigned), String(row.started), String(row.completed), String(row.overdue), pct(row.completionRate), pct(row.averageScore)];
  tableOrNote(doc, `By ${BY_LABEL[r.by].toLowerCase()}`, byCols, r.rows.length ? [...r.rows.map(line), line(r.totals)] : [], 'Nobody has this training yet.');

  tableOrNote(
    doc,
    'Overdue training',
    [{ header: 'Name' }, { header: 'Course' }, { header: 'Due', nowrap: true }, { header: 'Days late', align: 'right', nowrap: true }, { header: 'Mandatory', nowrap: true }, { header: 'Client', nowrap: true }],
    r.overdue.map((o) => [o.name, o.courseTitle, formatDay(o.dueDay), String(o.daysLate), yesNo(o.mandatory), yesNo(o.client)]),
    'No training is overdue.',
  );
  tableOrNote(
    doc,
    'Certificates expiring',
    [{ header: 'Name' }, { header: 'Course' }, { header: 'Expires', nowrap: true }],
    r.expiring.map((e) => [e.name, e.courseTitle, formatDay(expiresDay(e.expiresAt, meta.timeZone))]),
    'No certificates expire soon.',
  );
  tableOrNote(
    doc,
    'Quizzes',
    [{ header: 'Course' }, { header: 'Quiz' }, { header: 'Attempts', align: 'right', nowrap: true }, { header: 'Pass rate', align: 'right', nowrap: true }, { header: 'Average score', align: 'right', nowrap: true }],
    r.quizzes.map((q) => [q.courseTitle, q.title, String(q.attempts), pct(q.passRate), pct(q.averageScore)]),
    'No quiz attempts yet.',
  );
  return doc.build();
}
