import { Link } from 'react-router-dom';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { TimelineProject } from '../../api/planning';
import { ProjectAvatar } from '../ProjectAvatar';
import {
  HEALTH_LABEL,
  barLabel,
  barLabelSpot,
  barShape,
  datesFromTasks,
  daysBetween,
  heatLevel,
  lateNote,
  markerLabel,
  markerSpanDays,
  meetingMarkers,
  milestoneMarkerLabel,
  milestoneMarkers,
  monthMarks,
  shortDay,
  subline,
  todayLabel,
  xOf,
} from '../../lib/timeline';
import { BAR_TONE, ExpandButton, HEAT, HealthPill, ROW } from './parts';
import { ChartTaskRows } from './TimelineTasks';

/** What a click on the chart opens: a project's details, a group of its milestones, or of its meetings. */
export type TimelineDetail =
  | { kind: 'project'; projectId: string }
  | { kind: 'milestones'; projectId: string; first: string; last: string }
  | { kind: 'meetings'; projectId: string; first: string; last: string };

export const detailKey = (d: TimelineDetail) =>
  d.kind === 'project' ? `p:${d.projectId}` : `${d.kind === 'milestones' ? 'ms' : 'mt'}:${d.projectId}:${d.first}`;

interface ChartProps {
  range: { from: string; to: string; weeks: string[] };
  today: string;
  currentWeek: string;
  projects: TimelineProject[];
  busy: number[];
  scale: { size: number; labels: string[] };
  /** The detail that is open (its trigger shows as expanded, and `details` sits right after it). */
  open: string | null;
  details: ReactNode;
  onOpen: (detail: TimelineDetail, trigger: HTMLElement) => void;
  /** The projects whose tasks show under them. */
  expanded: ReadonlySet<string>;
  onExpand: (projectId: string) => void;
  /** Opens every shown project's tasks, or closes them all once all are open. */
  onExpandAll: () => void;
  onOpenTask: (taskId: string) => void;
}

/**
 * The chart: months and week starts on top, the busy weeks under them, then a row per project — its
 * bar from start to target filled to the share done, the part of a late project past its target
 * hatched up to today, its milestones (◆, filled once reached) and its meetings, grouped so markers
 * never overlap. Bars and markers are buttons whose details open right after them. The current week
 * is shaded and today is a labelled line. A project's row opens to show its tasks under it.
 */
export function TimelineChart({ range, today, currentWeek, projects, busy, scale, open, details, onOpen, expanded, onExpand, onExpandAll, onOpenTask }: ChartProps) {
  const total = daysBetween(range.from, range.to) + 1;
  const pct = (day: string) => xOf(day, range.from, total);
  const halfDay = 50 / total;
  const todayX = today >= range.from && today <= range.to ? pct(today) + halfDay : null;
  const weekX = currentWeek >= range.from && currentWeek <= range.to ? pct(currentWeek) : null;
  const col = 100 / range.weeks.length;

  const backdrop = (
    <div aria-hidden="true" className="week-lines pointer-events-none absolute inset-0" style={{ backgroundSize: `${col}% 100%` }}>
      {weekX !== null ? <div className="absolute inset-y-0 bg-brand/[0.05]" style={{ left: `${weekX}%`, width: `${(7 / total) * 100}%` }} /> : null}
      {todayX !== null ? <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brand" style={{ left: `${todayX}%` }} /> : null}
    </div>
  );

  const open$ = (detail: TimelineDetail) => (e: MouseEvent<HTMLButtonElement>) => onOpen(detail, e.currentTarget);

  return (
    // Relative: the screen-reader labels inside (absolutely placed) stay within this scroll box, not the page.
    <div className="relative overflow-x-auto">
      <div className="min-w-[52rem]">
        <div className={`${ROW} border-b border-line bg-surface-2`}>
          <div className="flex items-end justify-between gap-2 pb-1.5 pe-3 ps-4">
            <span className="pb-0.5 text-[11px] font-bold uppercase tracking-wider text-ink-2">Project</span>
            <button type="button" onClick={onExpandAll} className="min-h-[1.5rem] rounded-md px-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-ground hover:text-brand">
              {projects.every((p) => expanded.has(p.id)) ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
          <div className="relative h-[4.25rem] border-s border-line">
            {backdrop}
            <div aria-hidden="true">
              {monthMarks(range.from, range.to).map((m) => (
                <span
                  key={m.key}
                  className={`absolute top-1.5 whitespace-nowrap text-xs font-bold text-ink ${m.left > 85 ? 'pe-2' : 'ps-2'}`}
                  // A month that begins near the end keeps its label inside the edge.
                  style={m.left > 85 ? { right: 0 } : { left: `${m.left}%` }}
                >
                  {m.label}
                </span>
              ))}
              {range.weeks.map((w, i) => (
                <span
                  key={w}
                  className={`absolute top-6 text-center text-[11px] tabular-nums ${w === currentWeek ? 'font-bold text-brand' : 'text-ink-2'}`}
                  style={{ left: `${i * col}%`, width: `${col}%` }}
                >
                  {Number(w.slice(8))}
                </span>
              ))}
            </div>
            {todayX !== null ? (
              <span className="absolute bottom-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-brand px-1.5 py-0.5 text-[10.5px] font-bold text-white" style={{ left: `${todayX}%` }}>
                {todayLabel(today)}
              </span>
            ) : null}
          </div>
        </div>

        <div className={`${ROW} border-b border-line`}>
          <div className="px-4 py-2.5">
            <p className="text-[13px] font-bold text-ink">Busy weeks</p>
            <p className="truncate text-xs text-ink-2">Tasks due, all shown projects</p>
          </div>
          <ol aria-label="Open tasks due each week" className="grid gap-1 border-s border-line p-1.5" style={{ gridTemplateColumns: `repeat(${range.weeks.length}, minmax(0, 1fr))` }}>
            {busy.map((n, i) => (
              <li key={range.weeks[i]} className={`flex flex-col items-center justify-center rounded-lg py-1 text-[13px] font-bold leading-tight ${HEAT[heatLevel(n, scale.size)]}`}>
                <span className="sr-only">Week of {shortDay(range.weeks[i]!, today)}: </span>
                {n}
                {n ? <span className="text-[10px] font-semibold opacity-80">{n === 1 ? ' task' : ' tasks'}</span> : null}
              </li>
            ))}
          </ol>
        </div>

        <ul aria-label="Projects">
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              p={p}
              range={range}
              today={today}
              pct={pct}
              halfDay={halfDay}
              backdrop={backdrop}
              open={open}
              details={details}
              onOpen={open$}
              expanded={expanded.has(p.id)}
              onExpand={() => onExpand(p.id)}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProjectRow({
  p,
  range,
  today,
  pct,
  halfDay,
  backdrop,
  open,
  details,
  onOpen,
  expanded,
  onExpand,
  onOpenTask,
}: {
  p: TimelineProject;
  range: { from: string; to: string; weeks: string[] };
  today: string;
  pct: (day: string) => number;
  halfDay: number;
  backdrop: JSX.Element;
  open: string | null;
  details: ReactNode;
  onOpen: (detail: TimelineDetail) => (e: MouseEvent<HTMLButtonElement>) => void;
  expanded: boolean;
  onExpand: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { bar, over } = barShape(p, range, today);
  const tone = BAR_TONE[p.health];
  const inRange = (day: string | null): day is string => day !== null && day >= range.from && day <= range.to;
  const label = barLabel(p);
  const derived = datesFromTasks(p);
  const projectDetail: TimelineDetail = { kind: 'project', projectId: p.id };
  // Markers start far enough apart that none overlaps the next, at the chart's narrowest.
  const span = markerSpanDays(range.weeks.length);
  const meetings = meetingMarkers(p.meetings.filter((m) => inRange(m.day)), span);
  const milestones = milestoneMarkers(p.milestones.filter((m) => inRange(m.date)), span);
  const end = over ? over.left + over.width : bar ? bar.left + bar.width : 0;
  const sub = subline(p, today);
  const after = (detail: TimelineDetail) => (open === detailKey(detail) ? details : null);

  return (
    <li className="border-b border-line-2 last:border-b-0">
      <div className={ROW}>
        <div className="flex min-w-0 items-center gap-2 py-2 pe-4 ps-1.5">
          <ExpandButton name={p.name} expanded={expanded} onToggle={onExpand} className="h-7 w-7" />
          <ProjectAvatar project={p} size="md" />
          <div className="min-w-0 flex-1">
            <Link to={`/projects/${p.id}`} className="block truncate text-[13.5px] font-bold text-ink hover:text-brand">
              {p.name}
            </Link>
            <p className="truncate text-xs text-ink-2" title={sub}>
              {sub}
            </p>
          </div>
          <HealthPill health={p.health} />
        </div>
        <div className="relative h-[4.25rem] border-s border-line">
          {backdrop}
          {bar ? (
            <>
              <button
                type="button"
                onClick={onOpen(projectDetail)}
                aria-haspopup="dialog"
                aria-expanded={open === detailKey(projectDetail)}
                aria-label={`${p.name}: ${HEALTH_LABEL[p.health].toLowerCase()}, ${p.progress}% done${p.timeUsed !== null && p.health !== 'late' ? `, ${p.timeUsed}% of the time used` : ''}${p.health === 'late' ? `, ${p.daysLate} ${p.daysLate === 1 ? 'day' : 'days'} late` : ''}${derived ? ', dates from its tasks' : ''}. Details`}
                className={`absolute top-3 h-6 rounded-md text-start transition-shadow hover:shadow-lift focus-visible:z-20 ${tone.track} ${bar.startsBefore ? 'rounded-s-none' : ''} ${bar.endsAfter ? 'rounded-e-none' : ''} ${bar.open ? 'fade-end' : ''}`}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` } as CSSProperties}
              >
                {/* Dates from its tasks: a dashed outline round the bar. */}
                {derived ? <span aria-hidden="true" className="pointer-events-none absolute -inset-[3px] rounded-[7px] border-[1.5px] border-dashed border-ink-2/70" /> : null}
                <span aria-hidden="true" className={`absolute inset-y-0 start-0 ${tone.fill} ${bar.startsBefore ? '' : 'rounded-s-md'} ${bar.fill >= 100 && !bar.endsAfter ? 'rounded-e-md' : ''}`} style={{ width: `${bar.fill}%` }} />
                {/* Beside the end of the done part — inside it once it is long, after a short bar — so a milestone at the start never covers it. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-surface/90 px-1.5 text-[11px] font-bold leading-4 text-ink shadow-sm"
                  style={
                    {
                      inside: { right: `calc(${100 - bar.fill}% + 0.25rem)` },
                      'after-bar': { left: 'calc(100% + 0.375rem)' },
                      'after-fill': { left: `calc(${bar.fill}% + 0.25rem)` },
                    }[barLabelSpot(bar, label)]
                  }
                >
                  {label}
                </span>
              </button>
              {after(projectDetail)}
            </>
          ) : null}
          {over ? <span aria-hidden="true" className="hatch-late absolute top-3 h-6 rounded-e-md" style={{ left: `${over.left}%`, width: `${over.width}%` }} /> : null}
          {p.health === 'late' ? (
            <span className="absolute top-[2.55rem] whitespace-nowrap text-[11.5px] font-semibold text-danger" style={{ left: `calc(${Math.min(end, 78)}% + 0.375rem)` }}>
              {lateNote(p, today)}
            </span>
          ) : null}
          {milestones.map((g) => {
            const detail: TimelineDetail = { kind: 'milestones', projectId: p.id, first: g.first, last: g.last };
            return (
              <span key={g.key} className="contents">
                <button
                  type="button"
                  onClick={onOpen(detail)}
                  aria-haspopup="dialog"
                  aria-expanded={open === detailKey(detail)}
                  aria-label={milestoneMarkerLabel(g, today)}
                  className="absolute top-6 z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-sm focus-visible:z-20"
                  style={{ left: `${pct(g.first) + halfDay}%` }}
                >
                  <span aria-hidden="true" className={`h-2.5 w-2.5 rotate-45 ring-2 ring-ink ${g.done ? 'bg-ink' : 'bg-surface'}`} />
                  {g.items.length > 1 ? (
                    <span aria-hidden="true" className="absolute -end-1 -top-1 grid h-3.5 min-w-[0.875rem] place-items-center rounded-full bg-ink px-0.5 text-[9px] font-bold leading-none text-surface">
                      {g.items.length}
                    </span>
                  ) : null}
                </button>
                {after(detail)}
              </span>
            );
          })}
          {meetings.map((g) => {
            const detail: TimelineDetail = { kind: 'meetings', projectId: p.id, first: g.first, last: g.last };
            return (
              <span key={g.key} className="contents">
                <button
                  type="button"
                  onClick={onOpen(detail)}
                  aria-haspopup="dialog"
                  aria-expanded={open === detailKey(detail)}
                  aria-label={markerLabel(g)}
                  className="absolute top-[2.45rem] z-10 flex h-6 min-w-[1.5rem] -translate-x-1/2 items-center justify-center gap-0.5 rounded-sm px-0.5"
                  style={{ left: `${pct(g.first) + halfDay}%` }}
                >
                  {g.items.slice(0, 3).map((m) => (
                    <span key={m.id} aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-meeting" />
                  ))}
                </button>
                {after(detail)}
              </span>
            );
          })}
        </div>
      </div>
      {expanded ? <ChartTaskRows projectId={p.id} name={p.name} range={range} today={today} backdrop={backdrop} onOpenTask={onOpenTask} /> : null}
    </li>
  );
}
