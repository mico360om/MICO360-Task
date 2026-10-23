import { useEffect, useId, useRef, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { TimelineProject } from '../../api/planning';
import { datesLine, doneLine, lateNote, markerDays, nextLine, shortDay, weekdayDay } from '../../lib/timeline';
import { useDismiss } from '../../lib/useDismiss';
import { HealthPill } from './parts';
import type { TimelineDetail } from './TimelineChart';

const LINK = 'inline-flex min-h-[2rem] items-center rounded-lg border px-2.5 text-xs font-bold transition-colors';
const MAIN_LINK = `${LINK} border-info/40 bg-info-soft text-info hover:border-info`;
const OTHER_LINK = `${LINK} border-line bg-surface text-ink hover:border-brand/40`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-2">{k}</dt>
          <dd className="text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProjectLinks({ projectId }: { projectId: string }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link to={`/projects/${projectId}`} className={MAIN_LINK}>Open project</Link>
      <Link to={`/board?project=${encodeURIComponent(projectId)}`} className={OTHER_LINK}>Open board</Link>
    </div>
  );
}

/**
 * The details of what was clicked on the chart, next to it: a project's dates, how much is done and
 * overdue and its next milestone; a milestone; or a day's meetings — with links to open them.
 * Focus moves into it; Escape closes it and returns to the bar or marker.
 */
export function TimelineDetails({
  detail,
  project,
  today,
  timeZone,
  at,
  trigger,
  onClose,
}: {
  detail: TimelineDetail;
  project: TimelineProject;
  today: string;
  timeZone: string;
  at: { top: number; left: number };
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDismiss(true, onClose, root, trigger);
  useEffect(() => {
    root.current?.focus();
  }, [detail]);

  let body: JSX.Element;
  if (detail.kind === 'project') {
    const p = project;
    const rows: [string, string][] = [
      ['Dates', datesLine(p)],
      ['Done', doneLine(p)],
      ['Overdue', p.tasks.overdue ? plural(p.tasks.overdue, 'task') : 'None'],
      ['Next', nextLine(p, today)],
    ];
    if (p.health === 'late') rows.push(['Target', lateNote(p, today).replace(/^Target /, '')]);
    body = (
      <>
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="text-sm font-bold text-ink">{p.name}</h3>
          <HealthPill health={p.health} />
        </div>
        <Facts rows={rows} />
        <ProjectLinks projectId={p.id} />
      </>
    );
  } else if (detail.kind === 'milestone') {
    const m = project.milestones.find((x) => x.id === detail.milestoneId);
    const state = !m ? '' : m.done ? 'reached' : m.date && m.date < today ? 'overdue, not reached' : 'not reached yet';
    body = (
      <>
        <h3 id={titleId} className="text-sm font-bold text-ink">
          <span aria-hidden="true">◆ </span>
          {m?.title ?? 'Milestone'}
        </h3>
        {m ? <p className="font-mono text-[11px] text-ink-2">{m.key}</p> : null}
        <Facts
          rows={[
            ['Project', project.name],
            ['Due', m?.date ? `${shortDay(m.date, '0000')} · ${state}` : `No date · ${state}`],
          ]}
        />
        <ProjectLinks projectId={project.id} />
      </>
    );
  } else {
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
    const list = project.meetings.filter((m) => m.day >= detail.first && m.day <= detail.last);
    body = (
      <>
        <h3 id={titleId} className="text-sm font-bold text-ink">Meetings · {markerDays(detail)}</h3>
        <p className="text-xs text-ink-2">{project.name}</p>
        <ul className="mt-2 divide-y divide-line-2">
          {list.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-1.5">
              <span className="flex-none tabular-nums text-ink-2">{detail.first === detail.last ? '' : `${weekdayDay(m.day).split(' ').slice(0, 2).join(' ')} · `}{time.format(new Date(m.startAt))}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{m.title}</span>
              <Link to={`/meetings/${m.id}`} aria-label={`Open meeting ${m.title}`} className={OTHER_LINK}>
                Open meeting
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <div
      ref={root}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="absolute z-30 w-[min(20rem,calc(100%-1rem))] rounded-xl border border-line bg-surface p-3.5 text-[13px] shadow-lift outline-none animate-fade-in"
      style={{ top: at.top, left: at.left }}
    >
      {body}
    </div>
  );
}
