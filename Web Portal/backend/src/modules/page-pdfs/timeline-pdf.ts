/**
 * Timeline as a PDF: the five summary figures, then the chart as on the page — each shown project's row
 * (name, owner, progress) on the left and its bar across the shown weeks on the right, filled to the
 * share done in its health colour, the part past its target hatched when late, milestones as diamonds
 * (filled once reached), meetings as small squares, and a today line. A project whose tasks are open
 * on the page has its task rows under it. The whole range is scaled to the page's width.
 */
import { formatDay } from '../../lib/export-format';
import { HEALTH_TONES, OVERDUE_TONES } from '../../lib/colour-scheme';
import { BRAND, INK, LINE, MUTED, SOFT, TYPE, colourOr, note, pagePdf, plural, priorityTone, type PdfMeta } from './page-pdf-kit';

type Health = 'on-track' | 'at-risk' | 'late' | 'no-target';

export interface TimelineProjectWire {
  id: string;
  code: string;
  name: string;
  color: string;
  owner: { id: string; name: string } | null;
  start: string;
  target: string | null;
  tasks: { total: number; done: number; open: number; overdue: number };
  progress: number;
  timeUsed: number | null;
  health: Health;
  daysLate: number;
  milestones: { id: string; key: string; title: string; date: string | null; done: boolean }[];
  milestonesSoon: number;
  meetings: { id: string; title: string; day: string }[];
  meetingsThisWeek: number;
}
export interface TimelineWire {
  from: string;
  to: string;
  today: string;
  weeks: string[];
  projects: TimelineProjectWire[];
}
export interface TimelineTasksWire {
  projectId: string;
  matched: number;
  tasks: { id: string; key: string; title: string; start: string | null; due: string; done: boolean; overdue: boolean; priority: string; isMilestone: boolean }[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a: TimelineProjectWire, b: TimelineProjectWire) => collator.compare(a.name, b.name);
const RANK: Record<Health, number> = { late: 0, 'at-risk': 1, 'on-track': 2, 'no-target': 3 };
const severity = (p: TimelineProjectWire) => (p.health === 'late' ? p.daysLate : p.health === 'at-risk' ? (p.timeUsed ?? 0) - p.progress : 0);
const SORTERS = {
  attention: (a: TimelineProjectWire, b: TimelineProjectWire) => RANK[a.health] - RANK[b.health] || severity(b) - severity(a) || b.tasks.overdue - a.tasks.overdue || byName(a, b),
  name: byName,
  target: (a: TimelineProjectWire, b: TimelineProjectWire) => (a.target === b.target ? 0 : a.target === null ? 1 : b.target === null ? -1 : a.target < b.target ? -1 : 1) || byName(a, b),
} as const;
const SORT_WORD = { attention: 'Needs attention', name: 'Name', target: 'Target date' } as const;

/** The page's rows (lib/timeline.ts): the owner, then a summary card's "Late" or "At risk", sorted as chosen. */
export function timelineRows(projects: TimelineProjectWire[], opts: { owner: string; show: '' | 'late' | 'at-risk'; sort: keyof typeof SORTERS }) {
  const byOwner = projects.filter((p) => !opts.owner || p.owner?.id === opts.owner);
  const shown = byOwner.filter((p) => !opts.show || p.health === opts.show).sort(SORTERS[opts.sort]);
  return { byOwner, shown };
}

const HEALTH_FILL: Record<Health, string> = { 'on-track': HEALTH_TONES.ON_TRACK.light.fill, 'at-risk': HEALTH_TONES.AT_RISK.light.fill, late: HEALTH_TONES.LATE.light.fill, 'no-target': '#8F8580' };
const HEALTH_WORD: Record<Health, string> = { 'on-track': 'On track', 'at-risk': 'At risk', late: 'Late', 'no-target': 'No target' };
const MEETING = '#2F6DB5';

const dayNo = (key: string) => Math.round(Date.parse(`${key}T12:00:00Z`) / 86_400_000);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildTimelinePdf(
  data: TimelineWire,
  opts: { owner: string; show: '' | 'late' | 'at-risk'; sort: keyof typeof SORTERS; tasks: Map<string, TimelineTasksWire> },
  meta: PdfMeta,
): Buffer {
  const { byOwner, shown } = timelineRows(data.projects, opts);
  const ownerName = opts.owner ? (data.projects.find((p) => p.owner?.id === opts.owner)?.owner?.name ?? 'The chosen owner') : 'Anyone';
  const doc = pagePdf('Timeline', meta, {
    subtitle: `${formatDay(data.from)} – ${formatDay(data.to)}`,
    filters: [`Owner: ${ownerName}`, opts.show === 'late' ? 'Showing: late projects' : opts.show === 'at-risk' ? 'Showing: projects at risk' : '', `Sort: ${SORT_WORD[opts.sort]}`],
  });
  doc.statTiles([
    { label: 'Open projects', value: String(byOwner.length), tone: 'muted' },
    { label: 'Late · target passed', value: String(byOwner.filter((p) => p.health === 'late').length), tone: 'danger' },
    { label: 'At risk', value: String(byOwner.filter((p) => p.health === 'at-risk').length), tone: 'warning' },
    { label: 'Milestones in 30 days', value: String(byOwner.reduce((n, p) => n + p.milestonesSoon, 0)), tone: 'muted' },
    { label: 'Meetings this week', value: String(byOwner.reduce((n, p) => n + p.meetingsThisWeek, 0)), tone: 'brand' },
  ]);
  if (shown.length === 0) {
    note(doc, byOwner.length === 0 ? 'No open projects.' : 'No projects match these filters.');
    return doc.build();
  }

  const labelW = 200;
  const first = dayNo(data.from);
  const total = dayNo(data.to) - first + 1;
  const todayIn = data.today >= data.from && data.today <= data.to;
  /** x of a day's left edge (or its middle) inside the chart, clamped to it. */
  const xOf = (width: number, key: string, mid = false) => {
    const w = width - labelW;
    const d = Math.min(Math.max(dayNo(key) - first + (mid ? 0.5 : 0), 0), total);
    return labelW + (w * d) / total;
  };
  const todayLine = (p: Parameters<Parameters<typeof doc.canvas>[1]>[0], h: number) => {
    if (todayIn) p.line(xOf(p.width, data.today, true), 0, xOf(p.width, data.today, true), h, BRAND, { width: 1 });
  };

  const header = () =>
    doc.canvas(30, (p) => {
      p.rect(0, 0, p.width, 30, SOFT);
      p.text(6, 4, 'PROJECT', { size: TYPE.label, bold: true, color: MUTED });
      // The months on the first line, each week's first day under it.
      let month = '';
      for (let d = 0; d < total; d++) {
        const key = new Date((first + d) * 86_400_000 + 43_200_000).toISOString().slice(0, 10);
        const m = key.slice(0, 7);
        if (m !== month) {
          month = m;
          const x = xOf(p.width, key);
          p.line(x, 0, x, 30, LINE);
          p.text(x + 3, 3, `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`, { size: TYPE.label, bold: true, color: INK, maxWidth: 70 });
        }
      }
      const step = data.weeks.length > 16 ? 2 : 1;
      data.weeks.forEach((w, i) => {
        if (i % step) return;
        p.text(xOf(p.width, w) + 2, 17, String(Number(w.slice(8))), { size: TYPE.label, color: MUTED, maxWidth: 20 });
      });
      if (todayIn) p.text(xOf(p.width, data.today, true) - 20, 17, 'Today', { size: TYPE.label, bold: true, color: BRAND, maxWidth: 40, align: 'center' });
    });
  header();

  const rowH = 36;
  for (const project of shown) {
    doc.canvas(
      rowH,
      (p) => {
        p.line(0, rowH - 0.5, p.width, rowH - 0.5, LINE);
        for (const w of data.weeks) p.line(xOf(p.width, w), 0, xOf(p.width, w), rowH - 0.5, '#EEEBE8');
        p.rect(4, 5, 4, rowH - 10, colourOr(project.color, BRAND), { radius: 2 });
        p.text(13, 3, project.name, { size: TYPE.small, bold: true, maxWidth: labelW - 20 });
        p.text(13, 14, `${project.code} · ${project.owner?.name ?? 'No owner'}`, { size: TYPE.label, color: MUTED, maxWidth: labelW - 20 });
        const late = project.health === 'late' ? ` · ${plural(project.daysLate, 'day')} late` : '';
        p.text(13, 24, `${project.progress}% done · ${HEALTH_WORD[project.health]}${late}`, { size: TYPE.label, color: project.health === 'late' ? OVERDUE_TONES.light.text : MUTED, maxWidth: labelW - 20 });
        // The bar: start → target (or to the end of the range without one), filled to the share done.
        const end = project.target ?? data.to;
        if (end >= data.from && project.start <= data.to) {
          const x0 = xOf(p.width, project.start);
          const x1 = Math.max(x0 + 2, xOf(p.width, end > data.to ? data.to : end) + (p.width - labelW) / total);
          const fill = HEALTH_FILL[project.health];
          p.rect(x0, 11, x1 - x0, 12, '#FFFFFF', { radius: 3, stroke: fill, lineWidth: 0.8, ...(project.target ? {} : { dash: 2 }) });
          // The share done along the whole bar (its start may be before the shown weeks), then the part in view.
          const span = dayNo(end) + 1 - dayNo(project.start);
          const doneTo = dayNo(project.start) + (span * Math.min(100, Math.max(0, project.progress))) / 100;
          const xd = labelW + ((p.width - labelW) * Math.min(Math.max(doneTo - first, 0), total)) / total;
          if (xd > x0) p.rect(x0, 11, Math.min(xd, x1) - x0, 12, fill, { radius: 3 });
        }
        // Late: the part from the target to today, hatched.
        if (project.health === 'late' && project.target && project.target < data.today && project.target <= data.to) {
          const a = xOf(p.width, project.target < data.from ? data.from : project.target) + (project.target < data.from ? 0 : (p.width - labelW) / total);
          const b = xOf(p.width, data.today > data.to ? data.to : data.today, true);
          p.hatch(a, 11, b - a, 12, HEALTH_FILL.late, 2.5);
        }
        for (const m of project.meetings) if (m.day >= data.from && m.day <= data.to) p.rect(xOf(p.width, m.day, true) - 2.5, 26, 5, 5, MEETING, { radius: 1 });
        for (const m of project.milestones) if (m.date && m.date >= data.from && m.date <= data.to) p.diamond(xOf(p.width, m.date, true), 17, 4.5, m.done ? INK : '#FFFFFF', INK);
        todayLine(p, rowH);
      },
      { onNewPage: header },
    );
    const lane = opts.tasks.get(project.id);
    if (!lane) continue;
    const taskH = 16;
    if (lane.tasks.length === 0) {
      doc.canvas(taskH, (p) => p.text(24, 3, 'No open tasks in these weeks.', { size: TYPE.label, color: MUTED }), { onNewPage: header });
    }
    for (const t of lane.tasks) {
      doc.canvas(
        taskH,
        (p) => {
          p.line(labelW * 0.1, taskH - 0.5, p.width, taskH - 0.5, '#EEEBE8');
          p.text(24, 3, `${t.key} · ${t.title}`, { size: TYPE.label, color: t.overdue ? OVERDUE_TONES.light.text : INK, maxWidth: labelW - 28 });
          const colour = t.done ? HEALTH_TONES.ON_TRACK.light.fill : t.overdue ? OVERDUE_TONES.light.fill : priorityTone(t.priority).fill;
          if (t.isMilestone) {
            if (t.due >= data.from && t.due <= data.to) p.diamond(xOf(p.width, t.due, true), 8, 4, t.done ? INK : '#FFFFFF', INK);
          } else if (t.start && t.start < t.due) {
            const a = xOf(p.width, t.start < data.from ? data.from : t.start);
            const b = xOf(p.width, t.due > data.to ? data.to : t.due) + (p.width - labelW) / total;
            p.rect(a, 4, Math.max(2, b - a), 8, colour, { radius: 2 });
          } else if (t.due >= data.from && t.due <= data.to) {
            p.circle(xOf(p.width, t.due, true), 8, 3.2, colour);
          }
          todayLine(p, taskH);
        },
        { onNewPage: header },
      );
    }
    if (lane.matched > lane.tasks.length) doc.canvas(taskH, (p) => p.text(24, 3, `${plural(lane.matched - lane.tasks.length, 'more task')} not shown (as on the page).`, { size: TYPE.label, color: MUTED }), { onNewPage: header });
  }
  doc.spacer(6);
  note(doc, `Bars run from each project’s start to its target, filled to the share done: green on track, amber at risk, red late (hatched past the target). Diamonds are milestones (filled once reached), small blue squares meetings, and the red line is today (${formatDay(data.today)}).`);
  return doc.build();
}
