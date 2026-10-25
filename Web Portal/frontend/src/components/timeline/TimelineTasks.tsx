import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '../../api/client';
import { planningApi, timelineTasksKey, type TimelineTask, type TimelineTasksData } from '../../api/planning';
import { phoneTaskLine, shortDay, taskLabel, taskShape } from '../../lib/timeline';
import { Glyph, ICONS, Initials, ROW } from './parts';

/**
 * One project's task lane for the shown weeks, read when its row is opened, and again as tasks or
 * the weeks change. No placeholder: while other weeks load, the old rows are not drawn against them.
 */
function useTimelineTasks(projectId: string, range: { from: string; to: string }, today: string) {
  return useQuery({
    queryKey: timelineTasksKey(projectId, range.from, range.to, today),
    queryFn: () => planningApi(apiClient).timelineTasks(projectId, { from: range.from, to: range.to }),
  });
}

/** "Show all 12 open tasks", on the project's own Tasks tab. */
const allOpen = (n: number) => (n === 0 ? 'Open its tasks' : n === 1 ? 'Show its 1 open task' : `Show all ${n} open tasks`);

/** Under the rows: when some were cut, how many show and the project's open tasks; and its open tasks with no due date. */
function footerParts(projectId: string, data: TimelineTasksData): ReactNode[] {
  const parts: ReactNode[] = [];
  if (data.tasks.length === 0) parts.push(<span key="none">No tasks in these weeks.</span>);
  if (data.matched > data.tasks.length) {
    parts.push(
      <span key="shown">
        {data.tasks.length} of {data.matched} shown
      </span>,
      <Link key="all" to={`/projects/${encodeURIComponent(projectId)}?tab=tasks`} className="font-semibold text-brand hover:underline">
        {allOpen(data.open)}
      </Link>,
    );
  }
  if (data.undated) parts.push(<span key="undated">{data.undated === 1 ? '1 open task has no due date' : `${data.undated} open tasks have no due date`}</span>);
  return parts;
}

type Tone = 'overdue' | 'done' | 'open';
const toneOf = (t: TimelineTask): Tone => (t.done ? 'done' : t.overdue ? 'overdue' : 'open');
/** A task's colour: red when overdue, grey once done, else the timeline's blue. */
const TONE: Record<Tone, string> = { overdue: 'bg-danger', done: 'bg-ink-3/60', open: 'bg-info' };

function TaskMark({ t, range, today }: { t: TimelineTask; range: { from: string; to: string }; today: string }) {
  const shape = taskShape(t, range);
  if (shape.kind === 'bar') {
    return (
      <span
        aria-hidden="true"
        data-tone={toneOf(t)}
        className={`absolute top-1/2 h-3 -translate-y-1/2 rounded ${TONE[toneOf(t)]} ${shape.startsBefore ? 'rounded-s-none' : ''} ${shape.endsAfter ? 'rounded-e-none' : ''}`}
        style={{ left: `${shape.left}%`, width: `${shape.width}%` }}
      />
    );
  }
  if (shape.kind === 'marker') {
    return (
      <span aria-hidden="true" className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rtl:translate-x-1/2" style={{ left: `${shape.x}%` }}>
        <span data-tone={toneOf(t)} className={`block h-2.5 w-2.5 ${t.isMilestone ? 'rotate-45 rounded-[2px]' : 'rounded-full'} ${TONE[toneOf(t)]}`} />
      </span>
    );
  }
  // Due before or after the shown weeks: a note at that edge.
  const words = `due ${shortDay(t.due, today)}`;
  return (
    <span
      aria-hidden="true"
      data-tone={toneOf(t)}
      className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold ${shape.kind === 'before' ? 'start-1.5' : 'end-1.5'} ${t.overdue ? 'text-danger' : 'text-ink-2'}`}
    >
      {shape.kind === 'before' ? `◂ ${words}${t.overdue ? ' · overdue' : ''}` : `${words} ▸`}
    </span>
  );
}

/**
 * A project's task lane under it on the chart — open overdue work first, then open tasks in the
 * shown weeks, then done ones: a bar from start to due day (a marker on the due day when it has no
 * start), red with a warning sign when overdue, grey with a tick once done, and who has it. The whole row opens the
 * task. At most 30 — when more, how many show, and the project's open tasks on its own page.
 */
export function ChartTaskRows({
  projectId,
  name,
  range,
  today,
  backdrop,
  onOpenTask,
}: {
  projectId: string;
  name: string;
  range: { from: string; to: string };
  today: string;
  backdrop: JSX.Element;
  onOpenTask: (taskId: string) => void;
}) {
  const query = useTimelineTasks(projectId, range, today);
  const data = query.data;
  const footer = data ? footerParts(projectId, data) : [];
  const note = (content: ReactNode) => (
    <li className={ROW}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-2 pe-4 ps-[3.25rem] text-xs text-ink-2">{content}</div>
      <div className="relative border-s border-line">{backdrop}</div>
    </li>
  );

  return (
    <ul aria-label={`Tasks of ${name}`} aria-busy={query.isLoading} className="border-t border-line-2 bg-surface-2/50">
      {query.isLoading ? (
        note('Loading tasks…')
      ) : query.isError || !data ? (
        note(
          <>
            <span>Couldn’t load these tasks.</span>
            <button type="button" onClick={() => void query.refetch()} className="font-semibold text-brand hover:underline">
              Try again
            </button>
          </>,
        )
      ) : (
        <>
          {data.tasks.map((t) => (
            <li key={t.id} className={`${ROW} group relative hover:bg-ground/60`}>
              <div className="flex min-w-0 items-center gap-2 py-1.5 pe-4 ps-[3.25rem]">
                {/* Stretched over the whole row, so the bar opens the task too. */}
                <button
                  type="button"
                  onClick={() => onOpenTask(t.id)}
                  aria-label={taskLabel(t, today)}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 text-start text-[12.5px] after:absolute after:inset-0 after:z-10 after:content-[''] group-hover:underline ${t.done ? 'text-ink-3' : t.overdue ? 'font-semibold text-danger' : 'text-ink'}`}
                >
                  <span className="flex-none font-mono text-[11px] text-ink-2">{t.key}</span>
                  {t.done ? <Glyph size={13} className="text-success" data-icon="done">{ICONS.check}</Glyph> : null}
                  {t.overdue ? <Glyph size={13} data-icon="overdue">{ICONS.warning}</Glyph> : null}
                  {t.isMilestone ? <Glyph size={12} data-icon="milestone">{ICONS.diamond}</Glyph> : null}
                  <span className="min-w-0 truncate">{t.title}</span>
                </button>
                {/* Above the stretched button, so their names show on hover; the button's name says them too. */}
                <Initials people={t.assignees} className="relative z-20" />
              </div>
              <div className="relative h-8 border-s border-line">
                {backdrop}
                <TaskMark t={t} range={range} today={today} />
              </div>
            </li>
          ))}
          {footer.length ? note(footer) : null}
        </>
      )}
    </ul>
  );
}

/** A project's tasks on a phone: each with its due day, overdue or done, and who has it. */
export function PhoneTaskList({ projectId, name, range, today, onOpenTask }: { projectId: string; name: string; range: { from: string; to: string }; today: string; onOpenTask: (taskId: string) => void }) {
  const query = useTimelineTasks(projectId, range, today);
  const data = query.data;
  const footer = data ? footerParts(projectId, data) : [];
  const note = (content: ReactNode) => <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3.5 py-2 text-xs text-ink-2">{content}</li>;
  return (
    <ul aria-label={`Tasks of ${name}`} aria-busy={query.isLoading} className="divide-y divide-line-2 border-t border-line-2">
      {query.isLoading ? (
        note('Loading tasks…')
      ) : query.isError || !data ? (
        note(
          <>
            <span>Couldn’t load these tasks.</span>
            <button type="button" onClick={() => void query.refetch()} className="min-h-[2rem] font-semibold text-brand">
              Try again
            </button>
          </>,
        )
      ) : (
        <>
          {data.tasks.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-2 px-3.5 py-2 text-start hover:bg-ground/60">
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13px] ${t.done ? 'text-ink-3' : 'text-ink'}`}>
                    <span className="font-mono text-[11px] text-ink-2">{t.key}</span>
                    <span className="ms-1.5">{t.title}</span>
                  </span>
                  <span className={`block text-xs ${t.overdue ? 'font-semibold text-danger' : 'text-ink-2'}`}>{phoneTaskLine(t, today)}</span>
                </span>
                <Initials people={t.assignees} announce />
              </button>
            </li>
          ))}
          {footer.length ? note(footer) : null}
        </>
      )}
    </ul>
  );
}
