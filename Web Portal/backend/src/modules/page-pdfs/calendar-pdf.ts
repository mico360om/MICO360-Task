/**
 * Calendar as a PDF, as the page shows it: the month view as a month grid, the week view as a week grid
 * (each day's tasks and meetings as small chips; a day too full for its box ends with "+N more" and its
 * whole list follows the grid), and the day and agenda views as a list by day. The page names what each
 * day shows (its filters and Show choices applied); only items the calendar's own answer holds for this
 * person are printed.
 */
import { formatDay, wallClock } from '../../lib/export-format';
import { HEALTH_TONES, OVERDUE_TONES, STATUS_TONES } from '../../lib/colour-scheme';
import type { PdfDocument, PdfPainter } from '../../lib/pdf-document';
import { BRAND, BRAND_SOFT, INK, LINE, MUTED, SOFT, TYPE, note, pagePdf, plural, type PdfMeta } from './page-pdf-kit';
import { isDone, type ProjectRef, type TaskWire } from './task-wire';

export interface CalendarRangeWire {
  from: string;
  to: string;
  tasks: TaskWire[];
  spanning?: TaskWire[];
  series?: TaskWire[];
}
export interface MeetingWire {
  id: string;
  title: string;
  startAt: string;
  endAt?: string | null;
  status?: string;
  projectId?: string | null;
}
export interface CalendarDayAsk {
  day: string;
  items: { kind: 'task' | 'meeting'; id: string; status?: string }[];
}

type View = 'month' | 'week' | 'day' | 'agenda';
interface Chip {
  kind: 'task' | 'meeting';
  label: string;
  detail: string;
  fill: string;
  soft: string;
  text: string;
  dashed: boolean;
}

const MEETING = { fill: '#2F6DB5', soft: '#EAF0F8', text: '#2B64A6' };
const TONES: Record<string, { fill: string; soft: string; text: string }> = {
  overdue: OVERDUE_TONES.light,
  done: HEALTH_TONES.ON_TRACK.light,
  blocked: STATUS_TONES.BLOCKED.light,
  'in-progress': STATUS_TONES.IN_PROGRESS.light,
  todo: STATUS_TONES.TODO.light,
  projected: STATUS_TONES.BACKLOG.light,
};
const STATUS_WORDS: Record<string, string> = { overdue: 'Overdue', done: 'Done', blocked: 'Blocked', 'in-progress': 'In progress', todo: 'To do', projected: 'Repeat (to come)' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const shift = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (key: string) => new Date(`${key}T12:00:00.000Z`).getUTCDay();

/** The status a task shows on a day (the page's rule, lib/calendar-model.ts statusOf). */
function statusOf(t: TaskWire, day: string, today: string): string {
  if (isDone(t)) return 'done';
  if (day < today && !t.approvalRequestedAt) return 'overdue';
  if (t.columnCategory === 'BLOCKED') return 'blocked';
  if (t.columnCategory === 'IN_PROGRESS' || t.columnCategory === 'REVIEW') return 'in-progress';
  return 'todo';
}

export function buildCalendarPdf(
  range: CalendarRangeWire,
  meetings: MeetingWire[],
  days: CalendarDayAsk[],
  opts: { view: View; from: string; to: string; today: string; timeZone: string; filters: string[]; projects: Map<string, ProjectRef> },
  meta: PdfMeta,
): Buffer {
  // What this person's calendar holds: only these may be printed.
  const tasks = new Map<string, TaskWire>();
  for (const t of [...range.tasks, ...(range.spanning ?? []), ...(range.series ?? [])]) tasks.set(t.id, t);
  const meetingById = new Map(meetings.map((m) => [m.id, m]));
  const clock = (iso: string) => wallClock(new Date(iso), opts.timeZone).slice(11);

  const byDay = new Map<string, Chip[]>();
  for (const d of days) {
    if (d.day < opts.from || d.day > opts.to) continue;
    const chips: Chip[] = [];
    for (const it of d.items) {
      if (it.kind === 'task') {
        const t = tasks.get(it.id);
        if (!t) continue;
        const status = it.status && TONES[it.status] ? it.status : statusOf(t, d.day, opts.today);
        const tone = TONES[status]!;
        const project = opts.projects.get(t.projectId);
        chips.push({ kind: 'task', label: `${t.key} ${t.title}`, detail: [project ? project.name : '', STATUS_WORDS[status] ?? ''].filter(Boolean).join(' · '), ...tone, dashed: status === 'projected' });
      } else {
        const m = meetingById.get(it.id);
        if (!m) continue;
        const end = m.endAt ? `–${clock(m.endAt)}` : '';
        const cancelled = m.status === 'CANCELLED';
        chips.push({ kind: 'meeting', label: `${clock(m.startAt)} ${m.title}`, detail: `Meeting ${clock(m.startAt)}${end}${cancelled ? ' · Cancelled' : ''}`, ...MEETING, dashed: cancelled });
      }
    }
    if (chips.length) byDay.set(d.day, [...(byDay.get(d.day) ?? []), ...chips]);
  }

  const total = [...byDay.values()].reduce((n, c) => n + c.length, 0);
  const middle = shift(opts.from, Math.floor((Date.parse(`${opts.to}T12:00:00Z`) - Date.parse(`${opts.from}T12:00:00Z`)) / 86_400_000 / 2));
  const title = opts.view === 'month' ? `${MONTH_NAMES[Number(middle.slice(5, 7)) - 1]} ${middle.slice(0, 4)}` : opts.from === opts.to ? formatDay(opts.from, { weekday: true }) : `${formatDay(opts.from)} – ${formatDay(opts.to)}`;
  const viewWord = { month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda' }[opts.view];
  const doc = pagePdf('Calendar', meta, { subtitle: `${title} · ${viewWord} view`, filters: [...opts.filters, plural(total, 'item')] });

  const full: string[] = [];
  if (opts.view === 'month' || opts.view === 'week') {
    grid(doc, opts, byDay, middle, full);
    if (full.length) {
      doc.heading('Days with more than their box shows', { topGap: 10, keepWith: 60 });
      dayList(doc, full, byDay);
    }
  } else {
    const keys = [...byDay.keys()].sort();
    if (keys.length === 0) note(doc, 'Nothing on these days.');
    dayList(doc, keys, byDay);
  }
  return doc.build();
}

/** The month or week grid: weekday heads, then one block per week; the days that overflow go to `full`. */
function grid(doc: PdfDocument, opts: { view: View; from: string; to: string; today: string }, byDay: Map<string, Chip[]>, middle: string, full: string[]): void {
  const weeks: string[][] = [];
  for (let d = opts.from; d <= opts.to; d = shift(d, 1)) {
    if (weeks.length === 0 || weeks[weeks.length - 1]!.length === 7) weeks.push([]);
    weeks[weeks.length - 1]!.push(d);
  }
  const chipH = 11;
  const headH = 16;
  const rowH = opts.view === 'week' ? Math.min(doc.remaining - headH - 4, doc.pageRoom - headH) : Math.max(70, Math.min(96, Math.floor((doc.remaining - headH) / Math.max(1, weeks.length))));
  const head = () =>
    doc.canvas(headH, (p) => {
      const cw = p.width / 7;
      p.rect(0, 0, p.width, headH, SOFT);
      (weeks[0] ?? []).forEach((d, i) => p.text(i * cw, 4, WEEKDAYS[weekday(d)]!.toUpperCase(), { size: TYPE.label, bold: true, color: MUTED, maxWidth: cw, align: 'center' }));
    });
  head();
  const month = middle.slice(0, 7);
  for (const week of weeks) {
    doc.canvas(
      rowH,
      (p) => {
        const cw = p.width / 7;
        const fits = Math.max(1, Math.floor((rowH - 16) / chipH));
        week.forEach((d, i) => {
          const x = i * cw;
          const other = opts.view === 'month' && d.slice(0, 7) !== month;
          p.rect(x, 0, cw, rowH, other ? '#FAF9F8' : '#FFFFFF', { stroke: LINE });
          if (d === opts.today) p.rect(x + 0.5, 0.5, cw - 1, 13, BRAND_SOFT);
          const label = opts.view === 'week' || Number(d.slice(8)) === 1 ? formatDay(d, { year: false, weekday: opts.view === 'week' }) : String(Number(d.slice(8)));
          p.text(x + 4, 2, d === opts.today ? `${label} · Today` : label, { size: TYPE.label, bold: d === opts.today, color: d === opts.today ? BRAND : other ? '#A8A19B' : INK, maxWidth: cw - 8 });
          const chips = byDay.get(d) ?? [];
          const shown = chips.length > fits ? fits - 1 : chips.length;
          chips.slice(0, shown).forEach((c, k) => chip(p, x + 3, 15 + k * chipH, cw - 6, c));
          if (chips.length > shown) {
            p.text(x + 5, 15 + shown * chipH + 1, `+${chips.length - shown} more`, { size: TYPE.label, bold: true, color: MUTED, maxWidth: cw - 10 });
            full.push(d);
          }
        });
      },
      { onNewPage: head },
    );
  }
}

function chip(p: PdfPainter, x: number, y: number, w: number, c: Chip): void {
  p.rect(x, y, w, 10, c.soft, { radius: 2, ...(c.dashed ? { stroke: c.fill, dash: 1.5 } : {}) });
  p.rect(x, y, 2, 10, c.fill);
  p.text(x + 4, y + 0.5, c.label, { size: TYPE.label, color: c.text, maxWidth: w - 6 });
}

/** Each day's whole list: its date, then each item with its details. */
function dayList(doc: PdfDocument, keys: string[], byDay: Map<string, Chip[]>): void {
  for (const d of keys) {
    const chips = byDay.get(d) ?? [];
    doc.canvas(18, (p) => {
      p.text(0, 4, `${formatDay(d, { weekday: true })} · ${plural(chips.length, 'item')}`, { size: TYPE.small, bold: true, color: INK });
      p.line(0, 17.5, p.width, 17.5, LINE);
    });
    for (const c of chips) {
      doc.canvas(14, (p) => {
        p.rect(0, 2, 3, 10, c.fill);
        p.text(8, 1.5, c.label, { size: TYPE.small, color: INK, maxWidth: p.width * 0.62 });
        p.text(p.width * 0.64, 1.5, c.detail, { size: TYPE.label, color: c.kind === 'meeting' ? MEETING.text : MUTED, maxWidth: p.width * 0.36 });
      });
    }
    doc.spacer(4);
  }
}
