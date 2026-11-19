/**
 * My performance (and a person's performance, /performance/:userId) as a PDF: the KPI tiles, each with
 * its value, target and light; the page's trend drawn as bars, one row per KPI; and the projects counted.
 */
import type { StatTile } from '../../lib/pdf-document';
import { formatKpiTarget, formatKpiValue, type KpiUnit } from '../kpis/kpi-format';
import { HEALTH, INK, LINE, MUTED, TYPE, note, pagePdf, plural, type PdfMeta } from './page-pdf-kit';

type Light = 'green' | 'amber' | 'red' | 'none' | 'nodata';

export interface PersonKpisWire {
  person: { id: string; name: string; active: boolean };
  scope: 'self' | 'admin' | 'manager';
  projects: { id: string; code: string; name: string }[];
  period: { label: string };
  trend: { kind: 'month' | 'week'; points: { key: string; label: string; current: boolean }[] };
  tiles: {
    metric: string;
    label: string;
    unit: KpiUnit;
    direction: 'higher' | 'lower';
    value: number | null;
    target: number | null;
    light: Light;
    words: string;
    trend: (number | null)[];
  }[];
}

const SCOPE_WORDS = {
  self: 'Your own tasks in every project you’re on',
  admin: 'Their tasks in every project (seen by an administrator)',
  manager: 'Their tasks in the projects you run only',
} as const;
const TONE: Record<Light, StatTile['tone']> = { green: 'success', amber: 'warning', red: 'danger', none: 'muted', nodata: 'muted' };
const BAR: Record<Light, string> = { green: HEALTH.ON_TRACK.fill, amber: HEALTH.AT_RISK.fill, red: HEALTH.LATE.fill, none: '#8F8580', nodata: '#8F8580' };

/** A trend bar's label: just the number ("85%", "2.3"); progress as its share of plan. */
function shortValue(metric: string, unit: KpiUnit, v: number): string {
  if (metric === 'progress') return v === 100 ? '100%' : `${v}%`;
  return unit === 'percent' ? `${v}%` : String(Math.round(v * 10) / 10);
}

export function buildPerformancePdf(k: PersonKpisWire, opts: { self: boolean }, meta: PdfMeta): Buffer {
  const title = opts.self ? 'My performance' : `${k.person.name} · Performance`;
  const doc = pagePdf(title, meta, {
    subtitle: k.period.label,
    filters: [`Period: ${k.period.label}`, SCOPE_WORDS[k.scope] ?? '', k.person.active ? '' : 'This account is not active'],
  });

  // ── The tiles, four to a row, as on the page ──
  const tiles = k.tiles.map(
    (t): StatTile => ({
      label: t.label,
      value: formatKpiValue(t.metric, t.unit, t.value),
      note: t.target === null ? 'No target' : `${formatKpiTarget(t.metric, t.unit, t.direction, t.target)}${t.words ? ` · ${t.words}` : ''}`,
      tone: TONE[t.light] ?? 'muted',
    }),
  );
  doc.heading('KPIs', { topGap: 0, keepWith: 60 });
  for (let i = 0; i < tiles.length; i += 4) doc.statTiles(tiles.slice(i, i + 4));

  // ── The trend as bars: one row per KPI, one bar per period, the current one marked ──
  const points = k.trend.points;
  const rows = k.tiles.filter((t) => t.trend.some((v) => v !== null));
  if (points.length && rows.length) {
    doc.heading(k.trend.kind === 'week' ? 'Trend · last 12 weeks' : 'Trend · last 6 months', { topGap: 8, keepWith: 80 });
    const labelW = 150;
    const rowH = 34;
    const head = () =>
      doc.canvas(14, (p) => {
        const cw = (p.width - labelW) / points.length;
        points.forEach((pt, i) => p.text(labelW + i * cw, 1, pt.current ? `${pt.label} (now)` : pt.label, { size: TYPE.label, color: pt.current ? INK : MUTED, bold: pt.current, maxWidth: cw - 4, align: 'center' }));
      });
    doc.keepTogether(14 + rowH);
    head();
    for (const t of rows) {
      doc.canvas(
        rowH,
        (p) => {
          const cw = (p.width - labelW) / points.length;
          p.line(0, rowH - 0.5, p.width, rowH - 0.5, LINE);
          p.lines(0, 4, t.label, { size: TYPE.small, bold: true, maxWidth: labelW - 10, maxLines: 2 });
          const values = t.trend.slice(0, points.length);
          const max = Math.max(1, ...values.map((v) => (v === null ? 0 : Math.abs(v))));
          values.forEach((v, i) => {
            const x = labelW + i * cw + cw * 0.3;
            const w = cw * 0.4;
            const base = rowH - 4;
            p.line(x - 4, base, x + w + 4, base, LINE);
            if (v === null) {
              p.text(x, base - 10, '—', { size: TYPE.label, color: MUTED, maxWidth: w, align: 'center' });
              return;
            }
            const h = Math.max(1.5, ((base - 16) * Math.abs(v)) / max);
            p.rect(x, base - h, w, h, points[i]?.current ? BAR[t.light] : '#B9B2AC');
            p.text(x - 4, base - h - 10, shortValue(t.metric, t.unit, v), { size: TYPE.label, color: INK, maxWidth: w + 8, align: 'center' });
          });
        },
        { onNewPage: head },
      );
    }
  }

  // ── The projects counted ──
  doc.heading('Projects counted', { topGap: 8, keepWith: 30 });
  if (k.projects.length) doc.text(k.projects.map((p) => `${p.name} (${p.code})`).join(' · '), { size: TYPE.small });
  else note(doc, 'No projects yet.');
  note(doc, `${plural(k.tiles.length, 'KPI')} · ${k.period.label}`);
  return doc.build();
}
