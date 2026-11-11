/**
 * Project KPIs as files: the project KPI PDF (one page per project, the 1.23.11 PDF standard — the
 * Management page's PDF is the same page for each project in its table) and Excel workbooks (a project's
 * KPIs with their trend and its own KPIs; the Management KPI table).
 */
import { PdfDocument, PDF_STANDARD, type RGB, type StatTile, type TableColumn } from '../../lib/pdf-document';
import { buildXlsx, type XlsxColumn, type XlsxKind, type XlsxSheet, type XlsxValue } from '../../lib/xlsx-writer';
import { BRAND, formatDay, printedLine, slugPart } from '../../lib/export-format';
import { HEALTH_TONES } from '../../lib/colour-scheme';
import { resolveBrand } from '../email/brand';
import type { PdfBrand } from '../companies/company-branding';
import { METRIC, type Light, type Unit } from './kpi-defs';
import { formatCustomValue, formatKpiTarget, formatKpiValue } from './kpi-format';
import type { CustomKpiView, KpiTile, ManagementKpis, ProjectKpis } from './kpi-service';

const rgbOf = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as RGB;
const LIGHT_COLOR: Record<Light, RGB | null> = {
  green: rgbOf(HEALTH_TONES.ON_TRACK.light.text),
  amber: rgbOf(HEALTH_TONES.AT_RISK.light.text),
  red: rgbOf(HEALTH_TONES.LATE.light.text),
  none: null,
  nodata: null,
};
const LIGHT_TONE: Record<Light, StatTile['tone']> = { green: 'success', amber: 'warning', red: 'danger', none: 'muted', nodata: 'muted' };
const MUTED: RGB = [0.42, 0.4, 0.38];

const valueOf = (t: Pick<KpiTile, 'metric' | 'unit' | 'value'>) => formatKpiValue(t.metric, t.unit, t.value);
const targetOf = (t: Pick<KpiTile, 'metric' | 'unit' | 'direction' | 'target'>) => formatKpiTarget(t.metric, t.unit, t.direction, t.target);
const lightWord = (t: { light: Light; words: string }) => (t.light === 'green' || t.light === 'amber' || t.light === 'red' ? `• ${t.words}` : t.words || '—');

/** project-kpis-<code>-<day>.pdf / .xlsx */
export function projectKpiFileName(k: Pick<ProjectKpis, 'project' | 'today'>, ext: 'pdf' | 'xlsx'): string {
  return `${['project-kpis', slugPart(k.project.code), k.today].filter(Boolean).join('-')}.${ext}`;
}

export function managementKpiFileName(k: Pick<ManagementKpis, 'today'>, ext: 'pdf' | 'xlsx'): string {
  return `management-kpis-${k.today}.${ext}`;
}

/** One project's page: the KPIs as tiles, then a table with the targets, lights and trend, then its own KPIs. */
function projectPage(doc: PdfDocument, k: ProjectKpis, first: boolean): void {
  if (!first) doc.keepTogether(100_000);
  if (first) doc.reportHeader({ title: 'Project KPIs', subtitle: `${k.project.name} (${k.project.code})`, details: [k.period.label] });
  else {
    doc.heading(`${k.project.name} (${k.project.code})`, { topGap: 0, keepWith: 200 });
    doc.text(k.period.label, { size: PDF_STANDARD.type.small, color: MUTED, gap: 4 });
  }
  const tiles = k.tiles.map((t): StatTile => ({ label: t.label, value: valueOf(t), ...(t.target !== null ? { note: t.words } : {}), tone: LIGHT_TONE[t.light] }));
  doc.statTiles(tiles.slice(0, 4));
  doc.statTiles(tiles.slice(4));

  const labels = k.trend.points.map((p) => `${p.label}${p.rebuilt ? '*' : ''}`);
  const cols: TableColumn[] = [{ header: 'KPI' }, { header: 'Now', align: 'right', nowrap: true }, { header: 'Target', nowrap: true }, { header: 'Light', nowrap: true }, ...labels.map((l) => ({ header: l, align: 'right' as const, nowrap: true }))];
  const rows = k.tiles.map((t) => [t.label, valueOf(t), targetOf(t), lightWord(t), ...t.trend.map((v) => (v === null ? '—' : shortValue(t.metric, t.unit, v)))]);
  doc.heading(k.trend.kind === 'week' ? 'Last 12 weeks' : 'Last 6 months', { topGap: PDF_STANDARD.space.l, keepWith: doc.tableHeight(cols, rows, { firstRows: 2 }) });
  doc.table(cols, rows, { cellColor: (r, c) => (c === 3 ? LIGHT_COLOR[k.tiles[r]!.light] : null) });
  if (k.trend.points.some((p) => p.rebuilt)) doc.text('* Worked out from task dates and history when the KPIs started (best effort).', { size: PDF_STANDARD.type.small, color: MUTED, gap: 3 });
  if (k.custom.length) {
    const months = k.custom[0]!.values.map((v) => v.month);
    const ccols: TableColumn[] = [{ header: 'Own KPI' }, { header: 'Target', nowrap: true }, { header: 'Light', nowrap: true }, ...months.map((m) => ({ header: monthShort(m), align: 'right' as const, nowrap: true }))];
    const crows = k.custom.map((c) => [`${c.name}${c.unit ? ` (${c.unit})` : ''}`, customTarget(c), lightWord(c), ...c.values.map((v) => formatCustomValue(v.value, c.unit === '%' ? '%' : ''))]);
    doc.heading('The project’s own KPIs', { topGap: PDF_STANDARD.space.l, keepWith: doc.tableHeight(ccols, crows, { firstRows: 2 }) });
    doc.table(ccols, crows, { cellColor: (r, c) => (c === 2 ? LIGHT_COLOR[k.custom[r]!.light] : null) });
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]!;

/** A trend cell: just the number and its sign ("85%", "2.3", "Ahead 5%"). */
function shortValue(metric: string, unit: Unit, v: number): string {
  if (metric === 'progress') return v === 100 ? 'On plan' : v > 100 ? `+${v - 100}%` : `−${100 - v}%`;
  return unit === 'percent' ? `${v}%` : String(v);
}

function customTarget(c: CustomKpiView): string {
  if (c.target === null) return 'No target';
  return `${c.direction === 'HIGHER' ? 'At least' : 'At most'} ${formatCustomValue(c.target, c.unit)}`;
}

function newDoc(title: string, meta: { generatedAt: string; timeZone: string; generatedBy: string | null; company?: PdfBrand | null }): PdfDocument {
  return new PdfDocument({
    title,
    runningTitle: title,
    footer: { company: meta.company?.companyName ?? resolveBrand().companyName, printed: printedLine(new Date(meta.generatedAt), meta.timeZone, meta.generatedBy) },
    palette: { brand: BRAND },
    ...(meta.company?.logo ? { logo: meta.company.logo } : {}),
  });
}

/** A project's KPI PDF: one page. */
export function buildProjectKpiPdf(k: ProjectKpis, meta: { generatedBy: string | null; company?: PdfBrand | null }): Buffer {
  const doc = newDoc('Project KPIs', { generatedAt: k.generatedAt, timeZone: k.timeZone, ...meta });
  projectPage(doc, k, true);
  return doc.build();
}

/** The Management page's KPI PDF: the table first, then one page per project. */
export function buildManagementKpiPdf(table: ManagementKpis, pages: ProjectKpis[], meta: { generatedBy: string | null; company?: PdfBrand | null }): Buffer {
  const doc = newDoc('Project KPIs', { generatedAt: table.generatedAt, timeZone: table.timeZone, ...meta });
  doc.reportHeader({ title: 'Project KPIs', subtitle: table.scope === 'ALL' ? 'All projects' : 'Projects you run', details: [table.period.label] });
  const cols: TableColumn[] = [{ header: 'Project' }, ...table.metrics.map((m) => ({ header: m.label, align: 'right' as const }))];
  const rows = table.rows.map((r) => [`${r.project.name} (${r.project.code})`, ...table.metrics.map((m) => valueOf({ metric: m.metric, unit: m.unit, value: r.figures[m.metric]?.value ?? null }))]);
  if (rows.length === 0) doc.text('No projects match these filters.', { size: PDF_STANDARD.type.small, color: MUTED });
  else {
    const wide = PdfDocument.needsLandscape(cols, rows);
    if (wide) doc.orient('landscape');
    doc.table(cols, rows, { cellColor: (r, c) => (c > 0 ? LIGHT_COLOR[table.rows[r]!.figures[table.metrics[c - 1]!.metric]!.light] : null) });
    if (wide) doc.orient('portrait');
  }
  pages.forEach((p) => projectPage(doc, p, false));
  return doc.build();
}

const KIND: Record<Unit, XlsxKind> = { percent: 'percent', days: 'number', hours: 'number', tasks: 'integer', perWeek: 'number', items: 'integer' };
const unitWord: Record<Unit, string> = { percent: '%', days: 'working days', hours: 'working hours', tasks: 'tasks', perWeek: 'a week', items: 'items' };

/** A project's KPIs as an Excel workbook: the KPIs with their trend, and its own KPIs by month. */
export function buildProjectKpiXlsx(k: ProjectKpis, meta: { generatedBy: string | null }): Buffer {
  const notes = [`${k.project.name} (${k.project.code}) · ${k.period.label}`, printedLine(new Date(k.generatedAt), k.timeZone, meta.generatedBy)];
  const labels = k.trend.points.map((p) => `${p.label}${p.rebuilt ? ' (rebuilt)' : ''}`);
  const kpis: XlsxSheet = {
    name: 'KPIs',
    title: 'Project KPIs',
    notes,
    columns: [{ header: 'KPI' }, { header: 'Value', kind: 'number' }, { header: 'Unit' }, { header: 'Shown as' }, { header: 'Target' }, { header: 'Light' }, { header: 'Details', wrap: true }, ...labels.map((l): XlsxColumn => ({ header: l, kind: 'number' }))],
    rows: k.tiles.map((t): XlsxValue[] => [t.label, t.value, unitWord[t.unit], valueOf(t), targetOf(t), t.words || '—', t.detail ?? '', ...t.trend]),
  };
  const months = k.custom[0]?.values.map((v) => v.month) ?? [];
  const own: XlsxSheet = {
    name: 'Own KPIs',
    title: 'The project’s own KPIs',
    notes,
    columns: [{ header: 'KPI' }, { header: 'Unit' }, { header: 'Better' }, { header: 'Target', kind: 'number' }, { header: 'Light' }, ...months.map((m): XlsxColumn => ({ header: m, kind: 'number' })), { header: 'Notes', wrap: true }],
    rows: k.custom.map((c): XlsxValue[] => [
      c.name,
      c.unit,
      c.direction === 'HIGHER' ? 'Higher' : 'Lower',
      c.target,
      c.words,
      ...c.values.map((v) => v.value),
      c.values.filter((v) => v.note).map((v) => `${v.month}: ${v.note}`).join('; '),
    ]),
  };
  return buildXlsx([kpis, own], { title: `${k.project.code} KPIs`, brand: BRAND }, new Date(k.generatedAt));
}

/** The Management KPI table as an Excel sheet: a number and a light per KPI. */
export function buildManagementKpiXlsx(t: ManagementKpis, meta: { generatedBy: string | null }): Buffer {
  const columns: XlsxColumn[] = [{ header: 'Project' }, { header: 'Code' }, { header: 'Owner' }];
  for (const m of t.metrics) columns.push({ header: `${m.label}${m.unit === 'percent' && m.metric !== 'progress' ? '' : ` (${unitWord[m.unit]})`}`, kind: m.metric === 'progress' ? 'percent' : KIND[m.unit] }, { header: `${m.label}: light` });
  const rows = t.rows.map((r): XlsxValue[] => [r.project.name, r.project.code, r.owner?.name ?? '', ...t.metrics.flatMap((m) => [r.figures[m.metric]?.value ?? null, r.figures[m.metric]?.words ?? ''])]);
  const sheet: XlsxSheet = { name: 'Project KPIs', title: 'Project KPIs', notes: [`${t.scope === 'ALL' ? 'All projects' : 'Projects you run'} · ${t.period.label}`, printedLine(new Date(t.generatedAt), t.timeZone, meta.generatedBy)], columns, rows };
  return buildXlsx([sheet], { title: 'Project KPIs', brand: BRAND }, new Date(t.generatedAt));
}

/** "1 Nov 2026" helper for callers. */
export const dayWords = (d: string) => formatDay(d);
export const metricLabel = (m: string) => METRIC[m as keyof typeof METRIC]?.label ?? m;
