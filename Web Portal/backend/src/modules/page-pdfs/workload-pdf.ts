/**
 * Workload as a PDF: the week's table as on the page — one row per person (the most overloaded first)
 * with their week bar ("12 due · limit 25 · room for 13"), overdue tasks, and each day's number in the
 * page's tones (below, at or over the daily limit; a day off hatched). The week and filters in the header.
 */
import { formatDay } from '../../lib/export-format';
import { DUE_SOON_TONES, HEALTH_TONES, OVERDUE_TONES } from '../../lib/colour-scheme';
import { BRAND, BRAND_SOFT, INK, LINE, MUTED, SOFT, TYPE, note, pagePdf, plural, type PdfMeta } from './page-pdf-kit';

export interface WorkloadCellWire {
  date: string;
  count: number;
  limit: number;
  over: number;
  plannedMinutes?: number;
}
export interface WorkloadPersonWire {
  id: string;
  name: string;
  overdue: number;
  total: number;
  weekLimit: number;
  plannedMinutes?: number;
  days: WorkloadCellWire[];
}
export interface WorkloadWire {
  week: string;
  today: string;
  days: { date: string; working: boolean }[];
  limit: number;
  scope: 'everyone' | 'teams' | 'self';
  projectId: string | null;
  projects: { id: string; code: string; name: string }[];
  people: WorkloadPersonWire[];
}

type CellTone = 'off' | 'offdue' | 'none' | 'below' | 'at' | 'over';
/** The page's rule (lib/workload.ts cellTone). */
export function cellTone(cell: Pick<WorkloadCellWire, 'count' | 'limit'>): CellTone {
  if (cell.limit === 0) return cell.count === 0 ? 'off' : 'offdue';
  if (cell.count === 0) return 'none';
  if (cell.count > cell.limit) return 'over';
  return cell.count === cell.limit ? 'at' : 'below';
}

/** The week bar (lib/workload.ts weekBar). */
export function weekBar(p: Pick<WorkloadPersonWire, 'total' | 'weekLimit'>): { pct: number; tone: 'ok' | 'busy' | 'over'; text: string; note: string } {
  const pct = p.weekLimit > 0 ? Math.min(100, Math.round((p.total / p.weekLimit) * 100)) : p.total > 0 ? 100 : 0;
  const tone = p.total > p.weekLimit ? 'over' : pct >= 50 ? 'busy' : 'ok';
  const words = p.total > p.weekLimit ? `over by ${p.total - p.weekLimit}` : p.total === p.weekLimit ? 'at the limit' : `room for ${p.weekLimit - p.total}`;
  return { pct, tone, text: `${p.total} due · limit ${p.weekLimit}`, note: words };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const isOver = (c: WorkloadCellWire) => c.limit > 0 && c.over > 0;
const overBy = (p: WorkloadPersonWire) => p.days.reduce((n, c) => n + (isOver(c) ? c.over : 0), 0);

/** The page's order: the most overloaded first, then the busiest, then by name (lib/workload.ts sortPeople). */
export function sortPeople(people: WorkloadPersonWire[]): WorkloadPersonWire[] {
  return [...people].sort((a, b) => overBy(b) - overBy(a) || b.total - a.total || b.overdue - a.overdue || collator.compare(a.name, b.name));
}

/** "Find a person": every word in the name, case not minding (lib/workload.ts filterPeople). */
export function filterPeople(people: WorkloadPersonWire[], q: string): WorkloadPersonWire[] {
  const words = q.toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  return words.length ? people.filter((p) => words.every((w) => p.name.toLocaleLowerCase('en').includes(w))) : people;
}

function plannedWords(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${[h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')} planned`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayHeading = (key: string, today: string) => `${WEEKDAYS[new Date(`${key}T12:00:00Z`).getUTCDay()]} ${Number(key.slice(8))}${key === today ? ' · Today' : ''}`;

const RED = OVERDUE_TONES.light;
const AMBER = DUE_SOON_TONES.light;
const GREEN = HEALTH_TONES.ON_TRACK.light;
const BAR = { ok: GREEN.fill, busy: AMBER.fill, over: RED.fill } as const;

export function buildWorkloadPdf(data: WorkloadWire, opts: { q: string }, meta: PdfMeta): Buffer {
  const people = filterPeople(sortPeople(data.people), opts.q);
  const project = data.projectId ? data.projects.find((p) => p.id === data.projectId) : null;
  const last = data.days[data.days.length - 1]?.date ?? data.week;
  const over = people.filter((p) => p.days.some(isOver));
  const overDays = new Set(over.flatMap((p) => p.days.filter(isOver).map((c) => c.date)));
  const summary = over.length === 0 ? 'Nobody is over the daily limit.' : `${plural(over.length, 'person', 'people')} over the daily limit on ${plural(overDays.size, 'day')}.`;
  const scope = data.scope === 'teams' ? 'The people on the projects you manage' : data.scope === 'self' ? 'Your own tasks' : 'Everyone';
  const doc = pagePdf('Workload', meta, {
    subtitle: `${formatDay(data.week)} – ${formatDay(last)}`,
    filters: [`Project: ${project ? `${project.name} (${project.code})` : 'All'}`, opts.q.trim() ? `Find: “${opts.q.trim()}”` : '', `Daily limit: ${data.limit}`, scope, summary],
  });

  const nameW = 210;
  const overdueW = 56;
  const rowH = 42;
  const days = data.days;
  const header = () =>
    doc.canvas(20, (p) => {
      const dayW = (p.width - nameW - overdueW) / Math.max(1, days.length);
      p.rect(0, 0, p.width, 20, SOFT);
      p.text(6, 5, 'PERSON · THIS WEEK', { size: TYPE.label, bold: true, color: MUTED });
      p.text(nameW, 5, 'OVERDUE', { size: TYPE.label, bold: true, color: MUTED, maxWidth: overdueW, align: 'center' });
      days.forEach((d, i) => {
        const x = nameW + overdueW + i * dayW;
        if (d.date === data.today) p.rect(x, 0, dayW, 20, BRAND_SOFT);
        p.text(x, 5, dayHeading(d.date, data.today).toUpperCase(), { size: TYPE.label, bold: true, color: d.date === data.today ? BRAND : MUTED, maxWidth: dayW, align: 'center' });
      });
    });
  header();
  if (people.length === 0) {
    note(doc, opts.q.trim() ? `Nobody matches “${opts.q.trim()}”.` : 'Nobody to show for this week.');
    return doc.build();
  }
  for (const person of people) {
    const bar = weekBar(person);
    doc.canvas(
      rowH,
      (p) => {
        const dayW = (p.width - nameW - overdueW) / Math.max(1, days.length);
        p.line(0, rowH - 0.5, p.width, rowH - 0.5, LINE);
        p.text(6, 3, person.name, { size: TYPE.small, bold: true, maxWidth: nameW - 14 });
        p.rect(6, 16, 130, 4, SOFT, { radius: 2 });
        p.rect(6, 16, (130 * bar.pct) / 100, 4, BAR[bar.tone], { radius: 2 });
        p.text(6, 22, `${bar.text} · ${bar.note}`, { size: TYPE.label, color: bar.tone === 'over' ? RED.text : MUTED, maxWidth: nameW - 14 });
        const planned = plannedWords(person.plannedMinutes);
        if (planned) p.text(6, 30, planned, { size: TYPE.label, color: MUTED, maxWidth: nameW - 14 });
        p.text(nameW, 13, String(person.overdue), { size: TYPE.body, bold: true, color: person.overdue ? RED.text : '#A8A19B', maxWidth: overdueW, align: 'center' });
        person.days.forEach((c, i) => {
          const x = nameW + overdueW + i * dayW;
          if (c.date === data.today) p.rect(x, 0, dayW, rowH - 0.5, '#FBF6F6');
          const cw = Math.min(34, dayW - 8);
          const cx = x + (dayW - cw) / 2;
          const tone = cellTone(c);
          if (tone === 'off' || tone === 'offdue') {
            p.rect(cx, 6, cw, 22, null, { radius: 4, ...(tone === 'offdue' ? { stroke: AMBER.fill, lineWidth: 1 } : {}) });
            p.hatch(cx, 6, cw, 22, '#D9D4CF');
            p.text(cx, 12, tone === 'off' ? 'Off' : String(c.count), { size: tone === 'off' ? TYPE.label : TYPE.body, bold: true, color: tone === 'off' ? MUTED : INK, maxWidth: cw, align: 'center' });
          } else if (tone === 'none') {
            p.text(cx, 11, '0', { size: TYPE.body, bold: true, color: '#A8A19B', maxWidth: cw, align: 'center' });
          } else {
            const t = tone === 'over' ? RED : tone === 'at' ? AMBER : GREEN;
            p.rect(cx, 6, cw, 22, t.soft, { radius: 4, ...(tone === 'below' ? {} : { stroke: t.fill, lineWidth: tone === 'over' ? 1.5 : 1 }) });
            p.text(cx, 11, `${c.count}${tone === 'over' ? ' !' : ''}`, { size: TYPE.body, bold: true, color: t.text, maxWidth: cw, align: 'center' });
          }
          const planned = plannedWords(c.plannedMinutes);
          if (planned) p.text(x, 29, planned, { size: TYPE.label, color: MUTED, maxWidth: dayW, align: 'center' });
        });
      },
      { onNewPage: header },
    );
  }
  doc.spacer(6);
  note(doc, 'Numbers: open tasks due that day. Green below the daily limit, amber at it, red with “!” over it; hatched “Off” is not a working day, outlined amber is due on a day off.');
  return doc.build();
}
