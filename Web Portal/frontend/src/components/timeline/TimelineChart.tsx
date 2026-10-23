import { Link } from 'react-router-dom';
import type { CSSProperties, MouseEvent } from 'react';
import type { TimelineMeeting, TimelineProject } from '../../api/planning';
import { ProjectAvatar } from '../ProjectAvatar';
import {
  HEALTH_LABEL,
  barShape,
  daysBetween,
  heatLevel,
  lateNote,
  monthMarks,
  riskLabel,
  shortDay,
  subline,
  todayLabel,
  xOf,
} from '../../lib/timeline';
import { BAR_TONE, HEAT, HealthPill } from './parts';

/** What a click on the chart opens: a project's details, a milestone's, or a day's meetings. */
export type TimelineDetail =
  | { kind: 'project'; projectId: string }
  | { kind: 'milestone'; projectId: string; milestoneId: string }
  | { kind: 'meetings'; projectId: string; day: string };

export const detailKey = (d: TimelineDetail) =>
  d.kind === 'project' ? `p:${d.projectId}` : d.kind === 'milestone' ? `m:${d.milestoneId}` : `d:${d.projectId}:${d.day}`;

/** The left column and the weeks, the same in every row. */
const ROW = 'grid grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]';

const WEEKDAY_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "Thu 22 Oct". */
export const meetingDay = (key: string) => WEEKDAY_DAY.format(new Date(`${key}T12:00:00.000Z`)).replace(',', '').replace('Sept', 'Sep');

interface ChartProps {
  range: { from: string; to: string; weeks: string[] };
  today: string;
  currentWeek: string;
  projects: TimelineProject[];
  busy: number[];
  scale: { size: number; labels: string[] };
  /** The detail that is open (its trigger shows as expanded). */
  open: string | null;
  onOpen: (detail: TimelineDetail, trigger: HTMLElement) => void;
  onScroll?: () => void;
}

/**
 * The chart: months and week starts on top, the busy weeks under them, then a row per project — its
 * bar from start to target filled to the share done, the part of a late project past its target
 * hatched up to today, its milestones (◆, filled once reached) and its meetings. Bars and markers
 * are buttons that open their details. The current week is shaded and today is a labelled line.
 */
export function TimelineChart({ range, today, currentWeek, projects, busy, scale, open, onOpen, onScroll }: ChartProps) {
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
    <div className="overflow-x-auto" onScroll={onScroll}>
      <div className="min-w-[52rem]">
        <div className={`${ROW} border-b border-line bg-surface-2`}>
          <div className="flex items-end px-4 pb-2 text-[11px] font-bold uppercase tracking-wider text-ink-2">Project</div>
          <div className="relative h-[4.25rem] border-s border-line">
            {backdrop}
            <div aria-hidden="true">
              {monthMarks(range.from, range.to).map((m) => (
                <span key={m.key} className="absolute top-1.5 whitespace-nowrap ps-2 text-xs font-bold text-ink" style={{ left: `${m.left}%` }}>
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
            <ProjectRow key={p.id} p={p} range={range} today={today} pct={pct} halfDay={halfDay} backdrop={backdrop} open={open} onOpen={open$} />
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
  onOpen,
}: {
  p: TimelineProject;
  range: { from: string; to: string };
  today: string;
  pct: (day: string) => number;
  halfDay: number;
  backdrop: JSX.Element;
  open: string | null;
  onOpen: (detail: TimelineDetail) => (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { bar, over } = barShape(p, range, today);
  const tone = BAR_TONE[p.health];
  const inRange = (day: string | null): day is string => day !== null && day >= range.from && day <= range.to;
  const label = p.health === 'at-risk' ? riskLabel(p) : `${p.progress}%`;
  const projectDetail: TimelineDetail = { kind: 'project', projectId: p.id };
  // A day's meetings share one marker.
  const days = new Map<string, TimelineMeeting[]>();
  for (const m of p.meetings) days.set(m.day, [...(days.get(m.day) ?? []), m]);
  const end = over ? over.left + over.width : bar ? bar.left + bar.width : 0;
  const sub = subline(p, today);

  return (
    <li className={`${ROW} border-b border-line-2 last:border-b-0`}>
      <div className="flex min-w-0 items-center gap-2.5 px-4 py-2">
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
          <button
            type="button"
            onClick={onOpen(projectDetail)}
            aria-haspopup="dialog"
            aria-expanded={open === detailKey(projectDetail)}
            aria-label={`${p.name}: ${HEALTH_LABEL[p.health].toLowerCase()}, ${p.progress}% done${p.timeUsed !== null && p.health !== 'late' ? `, ${p.timeUsed}% of the time used` : ''}${p.health === 'late' ? `, ${p.daysLate} ${p.daysLate === 1 ? 'day' : 'days'} late` : ''}. Details`}
            className={`absolute top-3 h-6 rounded-md text-start transition-shadow hover:shadow-lift focus-visible:z-20 ${tone.track} ${bar.startsBefore ? 'rounded-s-none' : ''} ${bar.endsAfter ? 'rounded-e-none' : ''} ${bar.open ? 'fade-end' : ''}`}
            style={{ left: `${bar.left}%`, width: `${bar.width}%` } as CSSProperties}
          >
            <span aria-hidden="true" className={`absolute inset-y-0 start-0 ${tone.fill} ${bar.startsBefore ? '' : 'rounded-s-md'} ${p.progress >= 100 && !bar.endsAfter ? 'rounded-e-md' : ''}`} style={{ width: `${p.progress}%` }} />
            <span aria-hidden="true" className="pointer-events-none absolute start-1 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-surface/90 px-1.5 text-[11px] font-bold leading-4 text-ink shadow-sm">
              {label}
            </span>
          </button>
        ) : null}
        {over ? <span aria-hidden="true" className="hatch-late absolute top-3 h-6 rounded-e-md" style={{ left: `${over.left}%`, width: `${over.width}%` }} /> : null}
        {p.health === 'late' ? (
          <span className="absolute top-[2.55rem] whitespace-nowrap text-[11.5px] font-semibold text-danger" style={{ left: `calc(${Math.min(end, 78)}% + 0.375rem)` }}>
            {lateNote(p, today)}
          </span>
        ) : null}
        {p.milestones.filter((m) => inRange(m.date)).map((m) => {
          const detail: TimelineDetail = { kind: 'milestone', projectId: p.id, milestoneId: m.id };
          return (
            <button
              key={m.id}
              type="button"
              onClick={onOpen(detail)}
              aria-haspopup="dialog"
              aria-expanded={open === detailKey(detail)}
              aria-label={`Milestone ${m.title}, ${shortDay(m.date!, today)}, ${m.done ? 'reached' : 'not reached yet'}`}
              className="absolute top-6 z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-sm focus-visible:z-20"
              style={{ left: `${pct(m.date!) + halfDay}%` }}
            >
              <span aria-hidden="true" className={`h-2.5 w-2.5 rotate-45 ring-2 ring-ink ${m.done ? 'bg-ink' : 'bg-surface'}`} />
            </button>
          );
        })}
        {[...days].filter(([day]) => inRange(day)).map(([day, list]) => {
          const detail: TimelineDetail = { kind: 'meetings', projectId: p.id, day };
          return (
            <button
              key={day}
              type="button"
              onClick={onOpen(detail)}
              aria-haspopup="dialog"
              aria-expanded={open === detailKey(detail)}
              aria-label={list.length === 1 ? `Meeting ${list[0]!.title}, ${meetingDay(day)}` : `${list.length} meetings, ${meetingDay(day)}`}
              className="absolute top-[2.6rem] z-10 flex -translate-x-1/2 gap-0.5 rounded-sm p-0.5"
              style={{ left: `${pct(day) + halfDay}%` }}
            >
              {list.slice(0, 3).map((m) => (
                <span key={m.id} aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-meeting" />
              ))}
            </button>
          );
        })}
      </div>
    </li>
  );
}
