/**
 * The Management overview as a branded PDF for meetings: the company logo, the title, the filters in
 * words and when it was made (company time), the headline numbers, the project-health table (each
 * mark as a word and a dot, with its reasons), the tasks waiting for approval (in all and per project,
 * as on the page), the inspections summary with the most-failed items,
 * the people table and the trends (a chart and the same figures as a table). Page N of M.
 */
import { PDF_STANDARD, PdfDocument, type RGB, type TableColumn } from '../../lib/pdf-document';
import { BRAND, formatDay, printedLine, slugPart } from '../../lib/export-format';
import { resolveBrand } from '../email/brand';
import { zonedDayKey } from '../../lib/due-date';
import type { ProjectStatus, Rag } from './management-rules';
import { shortDay, type ManagementOverview } from './management-service';
import type { PdfBrand } from '../companies/company-branding';
import { HEALTH_TONES, OVERDUE_TONES, STATUS_TONES } from '../../lib/colour-scheme';

const RAG_WORD: Record<Rag, string> = { RED: 'Red', AMBER: 'Amber', GREEN: 'Green' };
/** 1.23.8: the health and overdue words in the one colour scheme's text tones (lib/colour-scheme.ts), on paper. */
const rgbOf = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as RGB;
const RAG_COLOR: Record<Rag, RGB> = { RED: rgbOf(HEALTH_TONES.LATE.light.text), AMBER: rgbOf(HEALTH_TONES.AT_RISK.light.text), GREEN: rgbOf(HEALTH_TONES.ON_TRACK.light.text) };
const DANGER: RGB = rgbOf(OVERDUE_TONES.light.text);
const MUTED: RGB = [0.42, 0.4, 0.38];
const STATUS_WORD: Record<ProjectStatus, string> = { PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };
const MONTH = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "4 Oct – 27 Oct 2026" (the first day's year only when it differs). */
export function rangeText(from: string, to: string): string {
  const a = formatDay(from);
  const b = formatDay(to);
  return MONTH.exec(from)?.[1] === MONTH.exec(to)?.[1] ? `${a.replace(/ \d{4}$/, '')} – ${b}` : `${a} – ${b}`;
}

/** The filters in words: "Projects: All · Owner: Anyone · Status: Planning, Active, On hold · Period: last 12 weeks (…)". */
export function filtersInWords(o: ManagementOverview): string {
  const names = o.filters.projectIds.map((id) => o.options.projects.find((p) => p.id === id)?.name).filter((n): n is string => !!n);
  const owner = o.filters.ownerId ? (o.options.owners.find((x) => x.id === o.filters.ownerId)?.name ?? 'The chosen owner') : 'Anyone';
  return [
    `Projects: ${names.length ? names.join(', ') : 'All'}`,
    `Owner: ${owner}`,
    `Status: ${o.filters.statuses.map((s) => STATUS_WORD[s]).join(', ')}`,
    `Period: last ${o.period.weeks} weeks (${rangeText(o.period.from, o.period.to)})`,
  ].join(' · ');
}

/** management-overview[-the one chosen project]-<company day>.pdf */
export function managementPdfFileName(o: ManagementOverview): string {
  const one = o.filters.projectIds.length === 1 ? o.options.projects.find((p) => p.id === o.filters.projectIds[0])?.name ?? '' : '';
  return `${['management-overview', slugPart(one), o.today].filter(Boolean).join('-')}.pdf`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 1.23.5: the Done column — "62%", or "62% by weight" for a project that counts by weight. */
export function doneCell(p: { completionPct: number; completionBy?: 'COUNT' | 'WEIGHT' }): string {
  return `${p.completionPct}%${p.completionBy === 'WEIGHT' ? ' by weight' : ''}`;
}

/** A project's next milestone in the health table: "RIG-1 · Handover · 24 Oct 2026 (3 days late)" — its number first (1.22.3). */
export function milestoneCell(m: ManagementOverview['projects'][number]['nextMilestone']): string {
  if (!m) return '—';
  const when = m.due ? formatDay(m.due) : 'no date';
  const late = m.workingDaysLate !== undefined ? (m.workingDaysLate > 0 ? `${plural(m.workingDaysLate, 'working day')} late` : 'late') : `${plural(-(m.daysLeft ?? 0), 'day')} late`;
  const state = m.waiting ? ' (waiting for approval)' : m.daysLeft !== null && m.daysLeft < 0 ? ` (${late})` : '';
  return `${m.key} · ${m.title} · ${when}${state}`;
}

export function buildManagementPdf(o: ManagementOverview, meta: { generatedBy: string | null; company?: PdfBrand | null }): Buffer {
  // ── Project health, its main table (laid out first: it decides the page shape) ──
  const healthCols: TableColumn[] = [
    { header: 'Mark', nowrap: true },
    { header: 'Project' },
    { header: 'Owner' },
    { header: 'Done', align: 'right', nowrap: true },
    { header: 'Late', align: 'right', nowrap: true },
    { header: 'Next milestone' },
    { header: 'Last activity', nowrap: true },
    { header: 'Why' },
  ];
  const healthRows = o.projects.map((p) => [
    `•\u00A0${RAG_WORD[p.rag]}`, // a no-break space: the dot never parts from its word
    `${p.name} (${p.code})`,
    p.owner?.name ?? '—',
    doneCell(p),
    String(p.late),
    milestoneCell(p.nextMilestone),
    formatDay(zonedDayKey(new Date(p.lastActivityAt), o.timeZone)),
    p.reasons.map((r) => r.text).join('; '),
  ]);
  // 1.23.11: portrait (owner: documents stay portrait); when the health table can't fit across a
  // portrait page, the whole overview is landscape (as before), so page 1 keeps its tiles and table
  // together; another table too wide turns its own section landscape. The footer: the company (its
  // own on a site with 2+ companies, else the site's), "Printed … by …" and the page; the company's
  // logo in the headers.
  const shape = PdfDocument.needsLandscape(healthCols, healthRows) ? 'landscape' : 'portrait';
  const doc = new PdfDocument({
    orientation: shape,
    title: 'Management overview',
    runningTitle: 'Management overview',
    footer: { company: meta.company?.companyName ?? resolveBrand().companyName, printed: printedLine(new Date(o.generatedAt), o.timeZone, meta.generatedBy) },
    palette: { brand: BRAND },
    ...(meta.company?.logo ? { logo: meta.company.logo } : {}),
  });
  doc.reportHeader({ title: 'Management overview', subtitle: o.scope === 'ALL' ? 'All projects' : 'Projects you run', details: [filtersInWords(o)] });
  const t = o.tiles;
  const note = (text: string) => doc.text(text, { size: PDF_STANDARD.type.small, color: MUTED, gap: 3 });
  /** A table too wide for a portrait page turns its section landscape, then back to the overview's shape. */
  const landscapeFor = (columns: TableColumn[], rows: string[][], draw: () => void) => {
    const wide = PdfDocument.needsLandscape(columns, rows);
    if (wide) doc.orient('landscape');
    draw();
    if (wide) doc.orient(shape);
  };

  doc.heading('At a glance', { topGap: 0, keepWith: 60 });
  doc.statTiles([
    { label: 'Projects', value: String(t.projects), note: `${t.red} red · ${t.amber} amber · ${t.green} green`, tone: t.red ? 'danger' : t.amber ? 'warning' : 'success' },
    { label: 'Late tasks', value: String(t.lateTasks), tone: t.lateTasks ? 'danger' : 'muted' },
    { label: 'Missing checks', value: String(t.missingChecks), tone: t.missingChecks ? 'danger' : 'muted' },
    { label: 'Checks done', value: `${t.checksDone} of ${t.checksDue}`, ...(t.checksDoneLate ? { note: `${t.checksDoneLate} late` } : {}), tone: 'brand' },
    { label: 'Pass rate', value: t.passRate === null ? 'None yet' : `${t.passRate}%`, tone: 'success' },
    { label: 'Overloaded this week', value: String(t.overloadedPeople), tone: t.overloadedPeople ? 'warning' : 'muted' },
  ]);

  // ── Project health ──
  landscapeFor(healthCols, healthRows, () => {
    doc.heading('Project health', { topGap: PDF_STANDARD.space.xl, keepWith: healthRows.length ? doc.tableHeight(healthCols, healthRows, { firstRows: 2 }) : 40 });
    if (healthRows.length === 0) note('No projects match these filters.');
    else
      doc.table(healthCols, healthRows, {
        // Not bold: a balanced table measures body cells at the normal weight, and the mark must stay on one line.
        cellColor: (r, c) => (c === 0 ? RAG_COLOR[o.projects[r]!.rag] : c === 4 && o.projects[r]!.late > 0 ? DANGER : null),
      });
  });

  // ── Waiting for approval (as the page's section: in all, then each project, most first) ──
  const ap = o.approvals;
  const apCols: TableColumn[] = [{ header: 'Project' }, { header: 'Waiting', align: 'right', nowrap: true }];
  const apRows = ap.projects.map((p) => [`${p.name} (${p.code})`, String(p.count)]);
  doc.section(() => {
    doc.heading('Waiting for approval', { topGap: PDF_STANDARD.space.xl, keepWith: apRows.length ? doc.tableHeight(apCols, apRows, { firstRows: 2 }) + 24 : 40 });
    note('Tasks finished but not approved yet by whoever runs the project. They don’t count as done until then.');
    if (apRows.length === 0) note('Nothing is waiting for approval.');
    else {
      note(`In all: ${plural(ap.total, 'task')}`);
      doc.table(apCols, apRows);
    }
  });

  // ── Inspections ──
  const ins = o.inspections;
  doc.section(() => {
    doc.heading('Inspections', { topGap: PDF_STANDARD.space.xl, keepWith: 80 });
    doc.keyValueColumns(
      [
        ['Checks due', String(ins.due)],
        ['Done', String(ins.done)],
        ['Done late', String(ins.doneLate)],
        ['Missing now', String(ins.missing)],
      ],
      [
        ['Closed without a report', String(ins.noReport)],
        ['Inspections finished', String(ins.finished)],
        ['Pass rate', ins.passRate === null ? 'None yet' : `${ins.passRate}% (${ins.passed} passed, ${ins.failed} failed)`],
        ['Open follow-ups', String(ins.openFollowUps)],
      ],
    );
    if (ins.topItems.length) {
      const cols: TableColumn[] = [{ header: 'Most-failed item' }, { header: 'Form' }, { header: 'Times failed', align: 'right', nowrap: true }];
      const rows = ins.topItems.map((i) => [i.label, i.formTitle, String(i.failures)]);
      doc.subheading('Most-failed items', { keepWith: doc.tableHeight(cols, rows, { firstRows: 2 }) });
      doc.table(cols, rows);
    }
    if (ins.topForms.length) {
      const cols: TableColumn[] = [{ header: 'Form' }, { header: 'Finished', align: 'right' }, { header: 'With a failure', align: 'right' }, { header: 'Failed items', align: 'right' }];
      const rows = ins.topForms.map((f) => [f.title, String(f.finished), String(f.withFailures), String(f.failedItems)]);
      doc.subheading('Forms with the most failed items', { keepWith: doc.tableHeight(cols, rows, { firstRows: 2 }) });
      doc.table(cols, rows);
    }
    if (ins.finished === 0 && ins.due === 0 && ins.missing === 0) note('No inspections yet in this period.');
  });

  // ── People ──
  const peopleCols: TableColumn[] = [
    { header: 'Person' },
    { header: 'Late tasks', align: 'right', nowrap: true },
    { header: 'Overloaded days this week' },
    { header: 'Open action items', align: 'right', nowrap: true },
    { header: 'Overdue action items', align: 'right', nowrap: true },
  ];
  const peopleRows = o.people.map((p) => [
    p.name,
    String(p.lateTasks),
    p.overloadedDays.length ? p.overloadedDays.map((d) => `${shortDay(d.date)} (${d.count} due, limit ${d.limit})`).join(', ') : '—',
    String(p.openActions),
    String(p.overdueActions),
  ]);
  landscapeFor(peopleCols, peopleRows, () =>
    doc.section(() => {
      doc.heading('People and workload', { topGap: PDF_STANDARD.space.xl, keepWith: peopleRows.length ? doc.tableHeight(peopleCols, peopleRows, { firstRows: 2 }) + 12 : 40 });
      note(`This week from ${formatDay(o.workload.week)}; daily limit ${o.workload.limit} open tasks on a working day.`);
      if (peopleRows.length === 0) note('Nobody has late work, an overloaded day or open action items.');
      else doc.table(peopleCols, peopleRows, { cellColor: (r, c) => ((c === 1 && o.people[r]!.lateTasks > 0) || (c === 2 && o.people[r]!.overloadedDays.length > 0) ? DANGER : null) });
    }),
  );

  // ── Trends ──
  doc.heading('Trends', { topGap: PDF_STANDARD.space.xl, keepWith: 160 });
  doc.lineChart({
    labels: o.trends.map((w) => w.label),
    series: [
      { name: 'Created', values: o.trends.map((w) => w.created), color: '#57514C' },
      { name: 'Completed', values: o.trends.map((w) => w.completed), color: STATUS_TONES.DONE.light.fill },
      { name: 'Late at the week’s end', values: o.trends.map((w) => w.late), color: OVERDUE_TONES.light.fill },
    ],
    height: 115,
  });
  doc.table(
    [{ header: 'Week starting', nowrap: true }, { header: 'Created', align: 'right' }, { header: 'Completed', align: 'right' }, { header: 'Late', align: 'right' }, { header: 'Pass rate', align: 'right' }],
    o.trends.map((w) => [`${formatDay(w.start)}${w.current ? ' (this week)' : ''}`, String(w.created), String(w.completed), String(w.late), w.passRate === null ? '—' : `${w.passRate}%`]),
  );
  return doc.build();
}
