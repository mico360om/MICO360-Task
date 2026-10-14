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
  other: 'bg-ink-3',
};

/** A compact timeline of what happened to the task, newest first, repetitive runs collapsed. */
export function ActivityTimeline({ activity }: { activity: DrawerActivity[] }) {
  const items = useMemo(() => buildTimeline(activity), [activity]);
  const [shown, setShown] = useState(FIRST);
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
              <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()} className="ms-1.5 whitespace-nowrap text-[11px] text-ink-3">
                · {relativeTime(item.createdAt)}
              </time>
            ) : null}
          </li>
        ))}
      </ul>
      {items.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + MORE)} className="mt-2 h-9 rounded-lg px-2 text-xs font-semibold text-brand hover:bg-ground sm:h-8">
          Load more
        </button>
      ) : null}
    </section>
  );
}
