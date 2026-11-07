import { dateTimeText } from '../../lib/day-words';
import { useMemo, useState } from 'react';
import { buildTimeline, type FeedEntry, type TimelineKind } from '../../lib/activity-feed';
import { relativeTime } from './comments';

export type DrawerActivity = FeedEntry;

/** How many lines show at first, and how many more each "Load more" adds. */
const FIRST = 5;
const MORE = 10;

const DOT: Record<TimelineKind, string> = {
  created: 'bg-info',
  moved: 'bg-brand',
  completed: 'bg-success',
  reopened: 'bg-warning',
  assigned: 'bg-brand-3',
  unassigned: 'bg-ink-3',
  updated: 'bg-ink-2',
  checklist: 'bg-success',
  comment: 'bg-info',
  file: 'bg-warning',
  blocker: 'bg-danger',
  external: 'bg-brand-2',
  other: 'bg-ink-3',
};

/** "Restore “Wiring” and its 3 sub-items", "Restore the checklist “Plumbing”" — from the line's own words. */
const restoreName = (text: string) => `Restore ${text.replace(/^deleted /, '').replace(/ \(\d+ items?\)$/, '')}`;

/**
 * A compact timeline of what happened to the task, newest first, repetitive runs collapsed.
 * `fromKeys` (1.23.1): history lines that came with a task merged into this one, by id — labelled "from MICO-14".
 * `restorable` + `onRestore` (1.23.3): a deleted checklist item or checklist has Restore while it can
 * still be restored (30 days).
 */
export function ActivityTimeline({
  activity,
  fromKeys,
  restorable,
  onRestore,
}: {
  activity: DrawerActivity[];
  fromKeys?: Record<string, string>;
  restorable?: ReadonlySet<string>;
  onRestore?: (batchId: string) => Promise<void> | void;
}) {
  const items = useMemo(() => buildTimeline(activity), [activity]);
  const [shown, setShown] = useState(FIRST);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ batchId: string; text: string } | null>(null);
  async function restore(batchId: string) {
    if (!onRestore || restoring) return;
    setRestoring(batchId);
    setProblem(null);
    try {
      await onRestore(batchId);
    } catch (err) {
      setProblem({ batchId, text: err instanceof Error && err.message ? err.message : 'Couldn’t restore it. Please try again.' });
    } finally {
      setRestoring(null);
    }
  }
  if (items.length === 0) return null;
  const visible = items.slice(0, shown);
  return (
    <section aria-labelledby="task-activity-heading">
      <h3 id="task-activity-heading" className="eyebrow mb-2">
        Activity
      </h3>
      <ul aria-label="Activity" className="relative flex flex-col gap-2.5 border-s border-line ps-4">
        {visible.map((item) => (
          <li key={item.id} className="relative text-[13px] leading-snug">
            <span aria-hidden="true" className={`absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${DOT[item.kind]}`} />
            <span className="text-ink">
              <span dir="auto" className="font-semibold">
                {item.actorName}
              </span>{' '}
              <span className="text-ink-2">{item.text}</span>
            </span>
            {item.path && item.path.length > 1 ? (
              <>
                <span aria-hidden="true" className="ms-1.5 inline-flex flex-wrap items-center gap-1 align-middle">
                  {item.path.map((s, i) => (
                    <span key={`${i}-${s}`} className="contents">
                      {i > 0 ? <span className="text-ink-3">→</span> : null}
                      <span className="rounded bg-ground px-1.5 py-px text-[11px] font-medium text-ink-2">{s}</span>
                    </span>
                  ))}
                </span>
                <span className="sr-only">: {item.path.join(', then ')}</span>
              </>
            ) : null}
            {item.createdAt ? (
              <time dateTime={item.createdAt} title={dateTimeText(item.createdAt)} className="ms-1.5 whitespace-nowrap text-[11px] text-ink-3">
                · {relativeTime(item.createdAt)}
              </time>
            ) : null}
            {fromKeys?.[item.id] ? (
              <span className="ms-1.5 whitespace-nowrap text-[11px] text-ink-3">
                · from <span dir="ltr" translate="no" className="font-mono">{fromKeys[item.id]}</span>
              </span>
            ) : null}
            {item.batchId && onRestore && restorable?.has(item.batchId) ? (
              <button
                type="button"
                onClick={() => void restore(item.batchId!)}
                disabled={restoring !== null}
                aria-label={restoreName(item.text)}
                className="ms-2 inline-flex h-7 items-center rounded-md border border-line px-2 align-middle text-[11px] font-semibold text-brand transition-colors hover:border-brand disabled:opacity-50 [@media(pointer:coarse)]:h-11"
              >
                {restoring === item.batchId ? 'Restoring…' : 'Restore'}
              </button>
            ) : null}
            {problem && problem.batchId === item.batchId ? (
              <p role="alert" className="mt-1 text-xs font-medium text-danger">
                {problem.text}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {items.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + MORE)} className="mt-2 h-9 rounded-lg px-2 text-xs font-semibold text-brand hover:bg-ground sm:h-8 [@media(pointer:coarse)]:h-11">
          Load more
        </button>
      ) : null}
    </section>
  );
}
