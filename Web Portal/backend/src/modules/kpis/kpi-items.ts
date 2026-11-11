/**
 * The list behind a KPI's number (the tiles open it): the tasks (or approvals, action items) it was
 * counted from, worked out by the same rules as the number (kpi-calc), worst first. A person's list
 * holds only what counted for them.
 */
import { workingDaysBetween, workingDaysLate } from '../../lib/working-days';
import { dueDayKey, zonedDayKey } from '../../lib/due-date';
import { formatDay } from '../../lib/export-format';
import type { CalcWindow } from './kpi-calc';
import type { MetricKey } from './kpi-defs';
import type { Facts } from './kpi-engine';
import type { BlockedTask } from './kpi-source';
import { countsInKpis } from './kpi-task-scope';
import { approvalCycles, assignedAt, baselineAsOf, doneMoment, judgedPeople, responsibleAt } from './task-history';
import { workingHoursBetween } from './working-time';

export interface KpiItemRow {
  kind: 'task' | 'actionItem';
  id: string;
  /** A task's number. */
  key: string | null;
  title: string;
  projectId: string | null;
  /** The agreed due day, when it has one. */
  due: string | null;
  /** When it counted as done. */
  doneDay: string | null;
  /** Working days late (or for: cycle time, working days from start to done). */
  days: number | null;
  /** Working hours (approval turnaround). */
  hours: number | null;
  people: string[];
  detail: string;
  tone: 'success' | 'danger' | 'warning' | 'neutral';
  /** An action item's meeting. */
  meetingId?: string | null;
}

/** Metrics with a list behind them. */
export const LISTED: readonly MetricKey[] = ['completed', 'onTime', 'daysLate', 'overdue', 'userOverdue', 'throughput', 'cycleTime', 'approvalTurnaround', 'blocked', 'actionItems'];
export const ITEMS_LIMIT = 200;

const ms = (d: Date) => d.getTime();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const one = (v: number) => Math.round(v * 10) / 10;

export function itemsFor(metric: MetricKey, f: Facts, w: CalcWindow, opts: { personId?: string; blocked?: BlockedTask[]; now: Date }): KpiItemRow[] {
  const tz = f.ctx.timeZone;
  const me = opts.personId;
  const inWindow = (d: Date) => ms(d) >= ms(w.from) && ms(d) < ms(w.to);
  const endAt = new Date(ms(w.to) - 1);
  const endDay = zonedDayKey(endAt, tz);
  const rows: (KpiItemRow & { sort: number })[] = [];
  const base = (t: Facts['tasks'][number]) => ({ kind: 'task' as const, id: t.id, key: t.key, title: t.title, projectId: t.projectId, people: t.assignees.map((a) => a.userId) });

  if (metric === 'blocked') {
    for (const b of opts.blocked ?? []) {
      const since = zonedDayKey(b.since, tz);
      const days = Math.max(0, Math.round((ms(opts.now) - ms(b.since)) / 86_400_000));
      rows.push({ kind: 'task', id: b.id, key: b.key, title: b.title, projectId: b.projectId, due: null, doneDay: null, days, hours: null, people: b.assigneeIds, detail: `Blocked since ${formatDay(since)} (${plural(days, 'day')})`, tone: days >= 5 ? 'danger' : 'warning', sort: -days });
    }
  } else if (metric === 'actionItems') {
    for (const a of f.actionItems) {
      if (!inWindow(a.completedAt) || (me && a.assigneeId !== me)) continue;
      const day = zonedDayKey(a.completedAt, tz);
      rows.push({ kind: 'actionItem', id: a.id, key: null, title: a.description, projectId: a.projectId, due: null, doneDay: day, days: null, hours: null, people: [a.assigneeId], detail: `Closed ${formatDay(day)}`, tone: 'success', meetingId: a.meetingId, sort: -ms(a.completedAt) });
    }
  } else if (metric === 'approvalTurnaround') {
    for (const t of f.tasks) {
      if (!countsInKpis(t, doneMoment(t) !== null)) continue;
      const pc = f.ctx.project(t.projectId);
      for (const c of approvalCycles(t)) {
        if (!inWindow(c.decidedAt) || (me && c.decidedBy !== me)) continue;
        const hours = one(workingHoursBetween(c.requestedAt, c.decidedAt, tz, pc.calendar, pc.hours));
        const word = c.outcome === 'APPROVED' ? 'Approved' : 'Sent back';
        rows.push({ ...base(t), due: null, doneDay: zonedDayKey(c.decidedAt, tz), days: null, hours, detail: `${word} after ${plural(hours, 'working hour')}`, tone: 'neutral', sort: -hours });
      }
    }
  } else {
    for (const t of f.tasks) {
      const doneAt = doneMoment(t);
      if (!countsInKpis(t, doneAt !== null)) continue;
      const pc = f.ctx.project(t.projectId);
      if (metric === 'overdue' || metric === 'userOverdue') {
        if (ms(t.createdAt) >= ms(w.to) || (doneAt && ms(doneAt) < ms(w.to))) continue;
        const due = baselineAsOf(t, endAt, pc.rules, tz);
        if (!due || due >= endDay) continue;
        const late = workingDaysLate(due, endDay, pc.calendar);
        if (late === 0) continue;
        if (me && !responsibleAt(t, endAt, pc.rules).includes(me)) continue;
        rows.push({ ...base(t), due, doneDay: null, days: late, hours: null, detail: `Due ${formatDay(due)} · ${plural(late, 'working day')} late`, tone: 'danger', sort: -late });
        continue;
      }
      if (!doneAt || !inWindow(doneAt)) continue;
      const doneDay = zonedDayKey(doneAt, tz);
      if (metric === 'completed' || metric === 'throughput') {
        if (me && !assignedAt(t, doneAt).includes(me)) continue;
        rows.push({ ...base(t), due: baselineAsOf(t, doneAt, pc.rules, tz), doneDay, days: null, hours: null, detail: `Finished ${formatDay(doneDay)}`, tone: 'success', sort: -ms(doneAt) });
      } else if (metric === 'cycleTime') {
        const start = dueDayKey(t.startDate, tz) ?? zonedDayKey(t.createdAt, tz);
        const days = Math.max(0, workingDaysBetween(start, doneDay, pc.calendar));
        rows.push({ ...base(t), due: null, doneDay, days, hours: null, detail: `${plural(days, 'working day')} from ${t.startDate ? 'its start' : 'when it was made'} to done`, tone: 'neutral', sort: -days });
      } else if (metric === 'onTime' || metric === 'daysLate') {
        const due = baselineAsOf(t, doneAt, pc.rules, tz);
        if (!due) continue;
        if (me && !judgedPeople(t, due, doneAt, tz, pc.rules).includes(me)) continue;
        const late = doneDay > due ? workingDaysLate(due, doneDay, pc.calendar) : 0;
        const onTime = late === 0;
        if (metric === 'daysLate' && onTime) continue;
        rows.push({
          ...base(t),
          due,
          doneDay,
          days: late,
          hours: null,
          detail: onTime ? `On time · due ${formatDay(due)}, finished ${formatDay(doneDay)}` : `${plural(late, 'working day')} late · due ${formatDay(due)}, finished ${formatDay(doneDay)}`,
          tone: onTime ? 'success' : 'danger',
          sort: onTime ? 0 : -late,
        });
      }
    }
  }
  return rows.sort((a, b) => a.sort - b.sort || (a.key ?? a.title).localeCompare(b.key ?? b.title, 'en', { numeric: true })).map(({ sort: _sort, ...r }) => r);
}
