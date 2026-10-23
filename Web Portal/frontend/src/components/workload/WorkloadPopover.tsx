import { useId, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { WorkloadCell, WorkloadPerson, WorkloadTask } from '../../api/planning';
import { popoverSub, popoverTitle, suggestionLabel, suggestionText } from '../../lib/workload';
import { AnchoredPopover } from '../ui/AnchoredPopover';

const ACTION = 'inline-flex min-h-[1.75rem] flex-none items-center whitespace-nowrap rounded-lg border border-info/40 bg-info-soft px-2 text-xs font-bold text-info transition-colors hover:border-info aria-disabled:cursor-wait aria-disabled:opacity-60';
const QUIET = 'inline-flex min-h-[1.75rem] flex-none items-center whitespace-nowrap rounded-lg border border-line bg-surface px-2 text-xs font-bold text-ink transition-colors hover:border-brand/40';

/** How many tasks a day at or under the limit lists before "+ N more". */
const LISTED = 5;

/**
 * One person's day, right after its number: how it stands against the limit, the tasks to move with
 * one suggestion each (a teammate with room, or a lighter day) when it is over, and a way to see the
 * rest. Nothing changes until a suggestion is clicked; while one is saved the others wait (and keep
 * focus — a busy button is never disabled outright).
 */
export function WorkloadPopover({
  person,
  cell,
  week,
  trigger,
  busyTaskId,
  notice,
  onApply,
  onOpenTask,
  onClose,
}: {
  person: WorkloadPerson;
  cell: WorkloadCell;
  week: string;
  trigger: RefObject<HTMLElement | null>;
  /** The task whose suggestion is being applied. */
  busyTaskId: string | null;
  /** What the last click did (or why it couldn't). */
  notice: { text: string; tone: 'done' | 'problem' } | null;
  onApply: (task: WorkloadTask) => void;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const listed = cell.over > 0 ? cell.tasks.slice(0, cell.over) : cell.tasks.slice(0, LISTED);
  const more = cell.count - listed.length;
  const rest = person.me
    ? { to: '/my-tasks', label: 'Open in My Tasks' }
    : { to: `/calendar?view=week&date=${cell.date}&assignee=${encodeURIComponent(person.id)}&done=0&meetings=0`, label: 'Open in Calendar' };

  return (
    <AnchoredPopover anchor={trigger} labelledBy={titleId} onClose={onClose} className="w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-line bg-surface p-3.5 text-[13px] font-normal shadow-lift">
      <h3 id={titleId} tabIndex={-1} data-popover-heading className="text-sm font-bold text-ink outline-none">{popoverTitle(person.name, cell.date)}</h3>
      <p className="mb-1.5 text-xs text-ink-2">{popoverSub(cell)}</p>
      {listed.length ? (
        <ul>
          {listed.map((t) => (
            <li key={t.id} className="flex items-center gap-2 border-t border-line-2 py-1.5">
              <span className="flex-none rounded-md bg-ground px-1.5 font-mono text-[11px] text-ink-2">{t.key}</span>
              <button type="button" onClick={() => onOpenTask(t.id)} title="Open the task" className="min-w-0 flex-1 truncate text-start text-ink hover:text-brand hover:underline">
                {t.title}
              </button>
              {t.suggestion ? (
                <button
                  type="button"
                  data-popover-action
                  onClick={() => (busyTaskId === null ? onApply(t) : undefined)}
                  aria-disabled={busyTaskId !== null || undefined}
                  aria-label={suggestionLabel(t.suggestion, t.key)}
                  className={ACTION}
                >
                  {busyTaskId === t.id ? 'Saving…' : suggestionText(t.suggestion, week)}
                </button>
              ) : cell.over > 0 ? (
                <span className="flex-none text-xs text-ink-3">No room nearby</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line-2 py-2 text-ink-2">Nothing due.</p>
      )}
      <div className="flex items-center gap-2 border-t border-line-2 pt-2">
        <span className="text-xs text-ink-2">{more > 0 ? `+ ${more} more` : ''}</span>
        <Link to={rest.to} className={`${QUIET} ms-auto`}>{rest.label}</Link>
      </div>
      <p aria-live="polite" className={`text-xs ${notice?.tone === 'problem' ? 'text-danger' : 'text-success'} ${notice ? 'mt-2' : ''}`}>
        {notice?.text ?? ''}
      </p>
    </AnchoredPopover>
  );
}
