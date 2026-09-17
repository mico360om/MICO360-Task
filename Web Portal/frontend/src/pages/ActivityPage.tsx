import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { activityApi, type ApiActivity } from '../api/activity';
import { PageHeader } from '../components/ui/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';

const ACTION_VERB: Record<string, string> = {
  CREATED: 'created',
  MOVED: 'moved',
  COMPLETED: 'completed',
  REOPENED: 'reopened',
  ASSIGNED: 'assigned',
};
const ACTION_TONE: Record<string, string> = {
  CREATED: 'text-info',
  MOVED: 'text-ink-2',
  COMPLETED: 'text-success',
  REOPENED: 'text-warning',
  ASSIGNED: 'text-brand',
};
const ACTION_DOT: Record<string, string> = {
  CREATED: 'bg-info',
  MOVED: 'bg-ink-3',
  COMPLETED: 'bg-success',
  REOPENED: 'bg-warning',
  ASSIGNED: 'bg-brand',
};
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'CREATED', label: 'Created' },
  { value: 'MOVED', label: 'Moved' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ASSIGNED', label: 'Assigned' },
];

const str = (v: unknown) => (typeof v === 'string' ? v : null);

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function dayHeader(iso: string): string {
  const d = new Date(iso);
  const key = d.toDateString();
  if (key === new Date().toDateString()) return 'Today';
  if (key === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** The human "what happened" line, using the recorded old→new meta where available. */
function detailOf(a: ApiActivity): string {
  const m = a.meta ?? {};
  const from = str(m.from);
  const to = str(m.to);
  switch (a.action) {
    case 'MOVED':
      return to ? `${from ?? '—'} → ${to}` : '';
    case 'COMPLETED':
      return to ? `marked complete in ${to}` : 'marked complete';
    case 'REOPENED':
      return to ? `re-opened in ${to}` : 're-opened';
    case 'ASSIGNED':
      return str(m.assignee) ? `→ ${str(m.assignee)}` : '';
    default:
      return '';
  }
}

export function ActivityPage() {
  const q = useQuery({ queryKey: ['activity'], queryFn: () => activityApi(apiClient).recent() });
  const [filter, setFilter] = useState('');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const rows = (q.data ?? []).filter(
    (a) => !filter || a.action === filter || (filter === 'COMPLETED' && a.action === 'REOPENED'),
  );

  const groups = useMemo(() => {
    const m = new Map<string, ApiActivity[]>();
    for (const a of rows) {
      const h = dayHeader(a.createdAt);
      (m.get(h) ?? m.set(h, []).get(h)!).push(a);
    }
    return [...m.entries()];
  }, [rows]);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? 'bg-brand text-white shadow-brand' : 'border border-line text-ink-2 hover:bg-ground'}`;

  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Activity" subtitle="Who did what, across your tasks and projects." />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)} className={chip(filter === f.value)}>{f.label}</button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
        </div>
      ) : q.isError ? (
        <p role="alert" className="text-danger">
          Couldn’t load activity. <button className="font-semibold underline" onClick={() => q.refetch()}>Retry</button>
        </p>
      ) : rows.length === 0 ? (
        <div className="card grid place-items-center gap-1 p-10 text-center">
          <p className="font-semibold text-ink">No activity yet</p>
          <p className="text-sm text-ink-2">Task creations, moves, completions and assignments will show up here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(([header, items]) => (
            <section key={header}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">{header}</h2>
              <ol className="ml-2 flex flex-col gap-1.5 border-l border-line pl-5">
                {items.map((a) => (
                  <li key={a.id} className="relative">
                    <span
                      className={`absolute -left-[26px] top-3 h-2.5 w-2.5 rounded-full ring-4 ring-ground ${ACTION_DOT[a.action] ?? 'bg-ink-3'}`}
                      aria-hidden="true"
                    />
                    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface p-2.5">
                      <Avatar name={a.actor?.name ?? '?'} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug text-ink">
                          <span className="font-semibold">{a.actor?.name ?? 'Someone'}</span>{' '}
                          <span className={ACTION_TONE[a.action] ?? 'text-ink-2'}>{ACTION_VERB[a.action] ?? a.action.toLowerCase().replace(/_/g, ' ')}</span>{' '}
                          {a.task ? (
                            <button onClick={() => setOpenTaskId(a.task!.id)} className="font-mono text-xs font-semibold text-brand hover:underline">{a.task.key}</button>
                          ) : (
                            <span className="text-ink-2">a task</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-ink-2">
                          {a.task?.title ?? ''}
                          {detailOf(a) ? <span className="text-ink-3"> · {detailOf(a)}</span> : null}
                          {a.project ? <span className="text-ink-3"> · {a.project.name}</span> : null}
                        </p>
                      </div>
                      <time className="flex-none text-xs text-ink-3" title={new Date(a.createdAt).toLocaleString()} dateTime={a.createdAt}>
                        {relativeTime(a.createdAt)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
    </div>
  );
}
