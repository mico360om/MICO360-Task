import { useId, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { TimelineProject } from '../../api/planning';
import { datesLine, doneLine, lateNote, markerDays, nextLine, shortDay, weekdayDay } from '../../lib/timeline';
import { AnchoredPopover } from '../ui/AnchoredPopover';
import { HealthPill } from './parts';
import type { TimelineDetail } from './TimelineChart';

const LINK = 'inline-flex min-h-[2rem] [@media(pointer:coarse)]:min-h-11 items-center rounded-lg border px-2.5 text-xs font-bold transition-colors';
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
 * The details of what was clicked on the chart, right after it: a project's dates, how much is done
 * and overdue and its next milestone; a group of milestones; or a group of meetings (their times in
 * company time, the zone their days are placed in) — with links to open them.
 */
export function TimelineDetails({
  detail,
  project,
  today,
  timeZone,
  trigger,
  onClose,
}: {
  detail: TimelineDetail;
  project: TimelineProject;
  today: string;
  /** The company's time zone. */
  timeZone: string;
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const titleId = useId();
  const title = 'text-sm font-bold text-ink outline-none';

  let body: JSX.Element;
  if (detail.kind === 'project') {
    const p = project;
    const rows: [string, string][] = [
      ['Dates', datesLine(p)],
      ['Done', doneLine(p)],
      ['Overdue', p.tasks.overdue ? plural(p.tasks.overdue, 'task') : 'None'],
      ['Next', nextLine(p, today)],
    ];
    // Late by its own target, or past its last task's due day when its end comes from its tasks.
    if (p.health === 'late') rows.push(p.targetFrom === 'tasks' ? ['Last task', lateNote(p, today).replace(/^Last task was /, '')] : ['Target', lateNote(p, today).replace(/^Target /, '')]);
    body = (
      <>
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} tabIndex={-1} data-popover-heading className={title}>{p.name}</h3>
          <HealthPill health={p.health} />
        </div>
        <Facts rows={rows} />
        <ProjectLinks projectId={p.id} />
      </>
    );
  } else if (detail.kind === 'milestones') {
    const list = project.milestones.filter((m) => m.date !== null && m.date >= detail.first && m.date <= detail.last);
    const stateOf = (m: (typeof list)[number]) => (m.done ? 'reached' : m.date! < today ? 'overdue, not reached' : 'not reached yet');
    const single = list.length === 1 ? list[0]! : null;
    body = single ? (
      <>
        <h3 id={titleId} tabIndex={-1} data-popover-heading className={title}>
          <span aria-hidden="true">◆ </span>
          {single.title}
        </h3>
        <p className="font-mono text-[11px] text-ink-2">{single.key}</p>
        <Facts
          rows={[
            ['Project', project.name],
            ['Due', `${shortDay(single.date!, '0000')} · ${stateOf(single)}`],
          ]}
        />
        <ProjectLinks projectId={project.id} />
      </>
    ) : (
      <>
        <h3 id={titleId} tabIndex={-1} data-popover-heading className={title}>Milestones · {markerDays({ first: detail.first, last: detail.last }).replace(/^[A-Z][a-z]{2} /, '')}</h3>
        <p className="text-xs text-ink-2">{project.name}</p>
        <ul className="mt-2 divide-y divide-line-2">
          {list.map((m) => (
            <li key={m.id} className="py-1.5">
              <span aria-hidden="true">◆ </span>
              <span className="font-medium text-ink">{m.title}</span>
              <span className="block text-xs text-ink-2">
                {m.key}
                {detail.first === detail.last ? '' : ` · ${shortDay(m.date!, today)}`} · {stateOf(m)}
              </span>
            </li>
          ))}
        </ul>
        <ProjectLinks projectId={project.id} />
      </>
    );
  } else {
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
    const list = project.meetings.filter((m) => m.day >= detail.first && m.day <= detail.last);
    body = (
      <>
        <h3 id={titleId} tabIndex={-1} data-popover-heading className={title}>Meetings · {markerDays(detail)}</h3>
        <p className="text-xs text-ink-2">{project.name}</p>
        <ul className="mt-2 divide-y divide-line-2">
          {list.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-1.5">
              <span className="flex-none tabular-nums text-ink-2">
                {detail.first === detail.last ? '' : `${weekdayDay(m.day).split(' ').slice(0, 2).join(' ')} · `}
                {time.format(new Date(m.startAt))}
              </span>
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
    <AnchoredPopover anchor={trigger} labelledBy={titleId} onClose={onClose} className="w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-line bg-surface p-3.5 text-[13px] shadow-lift">
      {body}
    </AnchoredPopover>
  );
}
