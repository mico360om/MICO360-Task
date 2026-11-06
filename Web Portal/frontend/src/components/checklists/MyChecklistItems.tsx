import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { checklistApi, type MyChecklistItem } from '../../api/checklist';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { todayKey } from '../../lib/due-date';
import { dueWords } from '../../lib/checklist-tree';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { useOpenTask } from '../../lib/useOpenTask';
import { failureMessage } from '../task-drawer/save-state';
import { TaskKey } from '../TaskKey';
import { DENSE_TEXT } from '../../lib/density-tokens';

/** The query behind My Tasks' "Checklist items for me" (refreshed with every task view). */
export const MY_CHECKLIST_KEY = ['my-checklist-items'] as const;

/** How many show before "Show all". */
const FIRST = 8;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * My Tasks' "Checklist items for me" (1.23.3, owner): the open checklist items assigned to me, across
 * my tasks — the task's number, the checklist, the item and its due date (late in red), and a tick box
 * for the real to-do items (a parent ticks itself once its sub-items are done, so it says how many are
 * still open). An item opens its task at it. Not shown while nothing is assigned to me.
 */
export function MyChecklistItems() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: MY_CHECKLIST_KEY, queryFn: () => checklistApi(apiClient).mine(), retry: false });
  // Only well-formed items (an older server answers something else, or nothing).
  const items = (Array.isArray(q.data) ? q.data : []).filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string' && typeof i.taskId === 'string' && typeof i.taskKey === 'string');
  const today = todayKey(useCompanyTimeZone());
  const openTask = useOpenTask();
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // Each tick shows until its own save (and the list read again after it) is done — never taken away by another's.
  const tickSeq = useRef(new Map<string, number>());

  async function tick(item: MyChecklistItem, done: boolean) {
    const seq = (tickSeq.current.get(item.id) ?? 0) + 1;
    tickSeq.current.set(item.id, seq);
    const settle = () => {
      if (tickSeq.current.get(item.id) === seq) setTicks((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== item.id)));
    };
    setTicks((t) => ({ ...t, [item.id]: done }));
    setProblem(null);
    try {
      await checklistApi(apiClient).toggle(item.id, done);
      setSaid(done ? `Ticked “${item.text}” on ${item.taskKey}.` : `Unticked “${item.text}” on ${item.taskKey}.`);
      void qc.invalidateQueries({ queryKey: ['checklist', item.taskId] });
      await invalidateTaskQueries(qc);
      // Read again: an item done has left the list (or shows as the server has it).
      settle();
    } catch (err) {
      // Not saved: the tick goes back as it was.
      settle();
      setProblem({ id: item.id, text: failureMessage(err, 'Couldn’t tick it. Please try again.') });
    }
  }

  if (items.length === 0) {
    return said ? (
      <p role="status" className="mb-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
        {said}
      </p>
    ) : null;
  }
  const shown = all ? items : items.slice(0, FIRST);
  const heading = `Checklist items for me (${items.length})`;
  return (
    <section aria-label={heading} data-testid="my-checklist-items" className="card mb-4 p-4">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-brand">
          <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        {heading}
      </h2>
      <p className="mt-0.5 text-xs text-ink-2">Steps of other tasks that were given to you. Tick them here or open the task.</p>
      <p role="status" aria-live="polite" className={said ? 'mt-2 text-xs font-medium text-success' : 'sr-only'}>
        {said}
      </p>
      <ul className="mt-2 divide-y divide-line">
        {shown.map((item) => {
          const done = item.id in ticks ? ticks[item.id]! : item.done;
          const due = dueWords(item.dueDate, today);
          const late = Boolean(item.dueDate && item.dueDate < today && !done);
          return (
            <li key={item.id} data-testid="my-checklist-item" data-item-id={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0 compact:py-1">
              {item.isParent ? null : (
                <label className="-m-1.5 grid h-8 w-8 flex-none cursor-pointer place-items-center [@media(pointer:coarse)]:-m-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                  <input type="checkbox" checked={done} aria-label={`${item.text} (${item.taskKey})`} onChange={() => void tick(item, !done)} className="h-[18px] w-[18px] accent-brand" />
                </label>
              )}
              <button
                type="button"
                onClick={() => openTask(item.taskId, undefined, { item: item.id })}
                aria-label={`Open ${item.taskKey} at “${item.text}”`}
                className="flex min-w-0 flex-[1_1_14rem] flex-col items-start gap-0.5 text-start [@media(pointer:coarse)]:min-h-11"
              >
                <span className="flex min-w-0 max-w-full items-center gap-2">
                  <TaskKey value={item.taskKey} dense="compact" />
                  <bdi className={`truncate text-sm font-medium hover:text-brand ${DENSE_TEXT} ${done ? 'text-ink-3 line-through' : 'text-ink'}`}>{item.text}</bdi>
                </span>
                <span className="max-w-full truncate text-xs text-ink-2">
                  <bdi>{item.listTitle}</bdi> · <bdi>{item.taskTitle}</bdi>
                </span>
              </button>
              {item.isParent ? <span className="flex-none rounded-md bg-ground px-1.5 py-0.5 text-xs font-medium text-ink-2">{`${plural(item.openSubItems, 'sub-item')} still open`}</span> : null}
              {due ? <span className={`flex-none text-xs tabular-nums ${late ? 'font-semibold text-danger' : 'text-ink-2'}`}>{late ? `Overdue · ${due}` : due}</span> : null}
              {problem?.id === item.id ? (
                <p role="alert" className="basis-full text-xs font-medium text-danger">
                  {problem.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {items.length > FIRST ? (
        <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="mt-2 h-9 rounded-lg px-2 text-xs font-semibold text-brand hover:bg-ground sm:h-8 [@media(pointer:coarse)]:h-11">
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      ) : null}
    </section>
  );
}
