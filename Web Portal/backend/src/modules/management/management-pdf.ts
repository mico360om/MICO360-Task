/**
 * The Management overview as a branded PDF for meetings: the company logo, the title, the filters in
 * words and when it was made (company time), the headline numbers, the project-health table (each
 * mark as a word and a dot, with its reasons), the inspections summary with the most-failed items,
 * the people table and the trends (a chart and the same figures as a table). Page N of M.
 */
import { PdfDocument, type RGB, type TableColumn } from '../../lib/pdf-document';
import { BRAND, formatDateTime, formatDay, slugPart } from '../../lib/export-format';
import { zonedDayKey } from '../../lib/due-date';
import type { ProjectStatus, Rag } from './management-rules';
import { shortDay, type ManagementOverview } from './management-service';

const RAG_WORD: Record<Rag, string> = { RED: 'Red', AMBER: 'Amber', GREEN: 'Green' };
const RAG_COLOR: Record<Rag, RGB> = { RED: [0.72, 0.16, 0.16], AMBER: [0.62, 0.4, 0.04], GREEN: [0.16, 0.45, 0.28] };
const DANGER: RGB = [0.72, 0.16, 0.16];
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

export function buildManagementPdf(o: ManagementOverview, meta: { generatedBy: string | null }): Buffer {
  const generated = `Generated ${formatDateTime(new Date(o.generatedAt), o.timeZone)} (${o.timeZone})${meta.generatedBy ? ` by ${meta.generatedBy}` : ''}`;
  const doc = new PdfDocument({
    orientation: 'landscape',
    title: 'Management overview',
    runningTitle: 'Management overview',
    footerLeft: `MICO360 Tasks · ${generated}`,
    palette: { brand: BRAND },
  });
  doc.reportHeader({ title: 'Management overview', subtitle: o.scope === 'ALL' ? 'All projects' : 'Projects you run', details: [filtersInWords(o), generated] });
  const t = o.tiles;
  const note = (text: string) => doc.text(text, { size: 9.5, color: MUTED, gap: 4 });

  doc.heading('At a glance', { size: 13, topGap: 2, keepWith: 90 });
  doc.statTiles([
    { label: 'Projects', value: String(t.projects), note: `${t.red} red · ${t.amber} amber · ${t.green} green`, tone: t.red ? 'danger' : t.amber ? 'warning' : 'success' },
    { label: 'Late tasks', value: String(t.lateTasks), tone: t.lateTasks ? 'danger' : 'muted' },
    { label: 'Missing checks', value: String(t.missingChecks), tone: t.missingChecks ? 'danger' : 'muted' },
    { label: 'Checks done', value: `${t.checksDone} of ${t.checksDue}`, ...(t.checksDoneLate ? { note: `${t.checksDoneLate} late` } : {}), tone: 'brand' },
    { label: 'Pass rate', value: t.passRate === null ? 'None yet' : `${t.passRate}%`, tone: 'success' },
    { label: 'Overloaded this week', value: String(t.overloadedPeople), tone: t.overloadedPeople ? 'warning' : 'muted' },
  ]);

  // ── Project health ──
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
    `${p.completionPct}%`,
    String(p.late),
    p.nextMilestone
      ? `${p.nextMilestone.title} · ${p.nextMilestone.due ? formatDay(p.nextMilestone.due) : 'no date'}${p.nextMilestone.daysLeft !== null && p.nextMilestone.daysLeft < 0 ? ` (${plural(-p.nextMilestone.daysLeft, 'day')} late)` : ''}`
      : '—',
    formatDay(zonedDayKey(new Date(p.lastActivityAt), o.timeZone)),
    p.reasons.map((r) => r.text).join('; '),
  ]);
  doc.heading('Project health', { size: 13, topGap: 16, keepWith: healthRows.length ? doc.tableHeight(healthCols, healthRows.slice(0, 3), { size: 8.5 }) : 40 });
  if (healthRows.length === 0) note('No projects match these filters.');
  else
    doc.table(healthCols, healthRows, {
      size: 8.5,
      fit: { minSize: 7 },
      // Not bold: a balanced table measures body cells at the normal weight, and the mark must stay on one line.
      cellColor: (r, c) => (c === 0 ? RAG_COLOR[o.projects[r]!.rag] : c === 4 && o.projects[r]!.late > 0 ? DANGER : null),
    });

  // ── Inspections ──
  const ins = o.inspections;
  doc.heading('Inspections', { size: 13, topGap: 16, keepWith: 110 });
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
    { size: 9.5 },
  );
  if (ins.topItems.length) {
    const cols: TableColumn[] = [{ header: 'Most-failed item' }, { header: 'Form' }, { header: 'Times failed', align: 'right', nowrap: true }];
    const rows = ins.topItems.map((i) => [i.label, i.formTitle, String(i.failures)]);
    doc.subheading('Most-failed items', { keepWith: doc.tableHeight(cols, rows.slice(0, 3), { size: 8.5 }) });
    doc.table(cols, rows, { size: 8.5, fit: {} });
  }
  if (ins.topForms.length) {
    const cols: TableColumn[] = [{ header: 'Form' }, { header: 'Finished', align: 'right' }, { header: 'With a failure', align: 'right' }, { header: 'Failed items', align: 'right' }];
    const rows = ins.topForms.map((f) => [f.title, String(f.finished), String(f.withFailures), String(f.failedItems)]);
    doc.subheading('Forms with the most failed items', { keepWith: doc.tableHeight(cols, rows.slice(0, 3), { size: 8.5 }) });
    doc.table(cols, rows, { size: 8.5, fit: {} });
  }
  if (ins.finished === 0 && ins.due === 0 && ins.missing === 0) note('No inspections yet in this period.');

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
  doc.heading('People and workload', { size: 13, topGap: 16, keepWith: peopleRows.length ? doc.tableHeight(peopleCols, peopleRows.slice(0, 3), { size: 8.5 }) : 40 });
  note(`This week from ${formatDay(o.workload.week)}; daily limit ${o.workload.limit} open tasks on a working day.`);
  if (peopleRows.length === 0) note('Nobody has late work, an overloaded day or open action items.');
  else doc.table(peopleCols, peopleRows, { size: 8.5, fit: {}, cellColor: (r, c) => ((c === 1 && o.people[r]!.lateTasks > 0) || (c === 2 && o.people[r]!.overloadedDays.length > 0) ? DANGER : null) });

  // ── Trends ──
  doc.heading('Trends', { size: 13, topGap: 16, keepWith: 200 });
  doc.lineChart({
    labels: o.trends.map((w) => w.label),
    series: [
      { name: 'Created', values: o.trends.map((w) => w.created), color: '#57514C' },
      { name: 'Completed', values: o.trends.map((w) => w.completed), color: '#2E7D53' },
      { name: 'Late at the week’s end', values: o.trends.map((w) => w.late), color: BRAND },
    ],
    height: 150,
  });
  doc.table(
    [{ header: 'Week starting', nowrap: true }, { header: 'Created', align: 'right' }, { header: 'Completed', align: 'right' }, { header: 'Late', align: 'right' }, { header: 'Pass rate', align: 'right' }],
    o.trends.map((w) => [`${formatDay(w.start)}${w.current ? ' (this week)' : ''}`, String(w.created), String(w.completed), String(w.late), w.passRate === null ? '—' : `${w.passRate}%`]),
    { size: 8.5, fit: {} },
  );
  return doc.build();
}
