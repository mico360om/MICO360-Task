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

const SUMMARY_HEADERS = ['People', 'Assigned', 'Started themselves', 'Started', 'Completed', 'Overdue', 'Completion rate', 'Average score'] as const;
const summaryValues = (r: ReportRow): XlsxValue[] => [r.people, r.assigned, r.selfStarted, r.started, r.completed, r.overdue, r.completionRate, r.averageScore];

/** R2: what the period's dates are about, in every file's header. */
const datesLine = (r: Pick<TrainingReport, 'dates'>) => (r.dates === 'finished' ? 'Dates by: Finished the course' : 'Dates by: Got the course');
/** 1.23.33: quiz results always count the day each quiz was handed in (as the page says), whatever "Dates by" is. */
const QUIZ_DATES_XLSX = 'Quiz results: by the day they were handed in';
const QUIZ_DATES_PDF = 'Quiz results count the day each quiz was handed in.';
const lastSeen = (iso: string | null, timeZone: string) => (iso ? formatDay(zonedDayKey(new Date(iso), timeZone)) : '—');

/** The report as an Excel workbook: Summary, Overdue, Certificates expiring, Quizzes. */
export function buildTrainingReportXlsx(r: TrainingReport, meta: ReportFileMeta): Buffer {
  const now = meta.now ?? new Date();
  const scopeLine = `By ${BY_LABEL[r.by].toLowerCase()} · ${SCOPE_LABEL[r.scope]}`;
  const notes = [scopeLine, datesLine(r), ...meta.filters, printedLine(now, meta.timeZone, meta.generatedBy)];
  const quizNotes = [scopeLine, QUIZ_DATES_XLSX, ...meta.filters, printedLine(now, meta.timeZone, meta.generatedBy)];
  const summary: XlsxSheet = {
    name: 'Summary',
    title: TITLE,
    notes,
    columns: [
      { header: BY_LABEL[r.by] },
      ...SUMMARY_HEADERS.slice(0, 6).map((header): XlsxColumn => ({ header, kind: 'integer' })),
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
    notes: quizNotes,
    columns: [
      { header: 'Quiz' },
      { header: 'Course' },
      { header: 'Module' },
      { header: 'Attempts', kind: 'integer' },
      { header: 'People', kind: 'integer' },
      { header: 'Pass rate', kind: 'percent' },
      { header: 'Average score', kind: 'percent' },
      { header: 'Questions', kind: 'integer' },
    ],
    rows: r.quizzes.map((q): XlsxValue[] => [q.title, q.courseTitle, q.moduleTitle ?? '', q.attempts, q.people, q.passRate, q.averageScore, q.questions]),
  };
  const sheets = [summary, overdue, expiring, quizzes];
  if (r.modules && r.learners) {
    sheets.push(
      {
        name: 'By module',
        title: 'By module',
        notes,
        columns: [{ header: 'Module' }, { header: 'People', kind: 'integer' }, { header: 'Done', kind: 'integer' }, { header: 'In progress', kind: 'integer' }, { header: 'Not started', kind: 'integer' }],
        rows: r.modules.map((m): XlsxValue[] => [m.title, m.people, m.done, m.inProgress, m.notStarted]),
      },
      {
        name: 'By person',
        title: 'By person',
        notes,
        columns: [{ header: 'Name' }, { header: 'Modules done', kind: 'integer' }, { header: 'Modules needed', kind: 'integer' }, { header: 'Last activity' }, { header: 'Certificate' }],
        rows: r.learners.map((l): XlsxValue[] => [l.name, l.modulesDone, l.modulesRequired, lastSeen(l.lastActivityAt, meta.timeZone), l.certificate?.code ?? '']),
      },
    );
  }
  return buildXlsx(sheets, { title: TITLE, brand: BRAND }, now);
}

/** A table, turned landscape when it can't fit across a portrait page; or a plain line when there is nothing. `about`: a line under the heading. */
function tableOrNote(doc: PdfDocument, heading: string, cols: TableColumn[], rows: string[][], none: string, about?: string): void {
  const aboutHeight = about ? 16 : 0;
  doc.heading(heading, { topGap: PDF_STANDARD.space.l, keepWith: (rows.length ? doc.tableHeight(cols, rows, { firstRows: 2 }) : 20) + aboutHeight });
  if (about) doc.text(about, { size: PDF_STANDARD.type.small, color: MUTED });
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
  doc.reportHeader({ title: TITLE, subtitle: `By ${BY_LABEL[r.by].toLowerCase()} · ${SCOPE_LABEL[r.scope]}`, details: [datesLine(r), ...meta.filters] });

  const t = r.totals;
  const tiles: StatTile[] = [
    { label: 'People', value: String(t.people), note: `${t.started} started` },
    { label: 'Completed', value: String(t.completed), note: `${t.completed} of ${t.enrolments} enrolments · ${pct(t.completionRate)}`, tone: 'success' },
    { label: 'Overdue', value: String(t.overdue), tone: t.overdue > 0 ? 'danger' : 'muted' },
    { label: 'Average score', value: pct(t.averageScore), tone: 'brand' },
  ];
  doc.statTiles(tiles);

  const byCols: TableColumn[] = [{ header: BY_LABEL[r.by] }, ...SUMMARY_HEADERS.map((header): TableColumn => ({ header, align: 'right', nowrap: true }))];
  const line = (row: ReportRow) => [row.label, String(row.people), String(row.assigned), String(row.selfStarted), String(row.started), String(row.completed), String(row.overdue), pct(row.completionRate), pct(row.averageScore)];
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
    [
      { header: 'Quiz' },
      { header: 'Course' },
      { header: 'Module' },
      { header: 'Attempts', align: 'right', nowrap: true },
      { header: 'People', align: 'right', nowrap: true },
      { header: 'Pass rate', align: 'right', nowrap: true },
      { header: 'Average score', align: 'right', nowrap: true },
      { header: 'Questions', align: 'right', nowrap: true },
    ],
    r.quizzes.filter((q) => q.attempts > 0).map((q) => [q.title, q.courseTitle, q.moduleTitle ?? '—', String(q.attempts), String(q.people), pct(q.passRate), pct(q.averageScore), String(q.questions)]),
    'No quiz attempts yet.',
    QUIZ_DATES_PDF,
  );
  if (r.modules && r.learners) {
    tableOrNote(
      doc,
      'By module',
      [{ header: 'Module' }, { header: 'People', align: 'right', nowrap: true }, { header: 'Done', align: 'right', nowrap: true }, { header: 'In progress', align: 'right', nowrap: true }, { header: 'Not started', align: 'right', nowrap: true }],
      r.modules.map((m) => [m.title, String(m.people), String(m.done), String(m.inProgress), String(m.notStarted)]),
      'This course has no modules.',
    );
    tableOrNote(
      doc,
      'By person',
      [{ header: 'Name' }, { header: 'Modules', align: 'right', nowrap: true }, { header: 'Last activity', nowrap: true }, { header: 'Certificate', nowrap: true }],
      r.learners.map((l) => [l.name, `${l.modulesDone} of ${l.modulesRequired}`, lastSeen(l.lastActivityAt, meta.timeZone), l.certificate?.code ?? '—']),
      'Nobody has this course yet.',
    );
  }
  return doc.build();
}
