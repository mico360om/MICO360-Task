import { clockText, dateTimeText, instantDayText } from '../lib/day-words';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { activityApi, type ActivityKind, type ApiActivity } from '../api/activity';
import { PageHeader } from '../components/ui/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { Button } from '../components/ui/Button';
import { TaskDrawerContainer } from '../components/TaskDrawerContainer';
import { TaskKeyButton } from '../components/TaskKey';
import { relativeTime } from '../lib/relative-time';
import { FirstStepsActions, FirstStepsIcon, useNoProjectsYet } from '../components/FirstSteps';
import { ActivityCalendar } from '../components/activity/ActivityCalendar';
import { ACTIVITY_VIEW_PREF } from '../lib/activity-calendar';
import { readUserValue, writeUserValue } from '../lib/user-storage';
import { useAuthStore } from '../stores/auth-store';

const ACTION_VERB: Record<string, string> = {
  CREATED: 'created',
  MOVED: 'moved',
  COMPLETED: 'completed',
  REOPENED: 'reopened',
  ASSIGNED: 'assigned',
  PROJECT_CHANGED: 'moved',
  PROJECT_MOVED_OUT: 'moved',
  // Task approvals.
  APPROVAL_REQUESTED: 'asked for approval on',
  APPROVED: 'approved',
  SENT_BACK: 'sent back',
  APPROVAL_WITHDRAWN: 'withdrew the approval request on',
  // Companies: a line on the project itself (no task).
  PROJECT_COMPANIES_CHANGED: 'changed the companies of',
};
/** Lines about a project itself: they name the project, not "a task". */
const PROJECT_LINES = new Set(['PROJECT_COMPANIES_CHANGED']);
const ACTION_TONE: Record<string, string> = {
  CREATED: 'text-info',
  MOVED: 'text-ink-2',
  COMPLETED: 'text-success',
  REOPENED: 'text-warning',
  ASSIGNED: 'text-brand',
  PROJECT_CHANGED: 'text-ink-2',
  PROJECT_MOVED_OUT: 'text-ink-2',
  APPROVAL_REQUESTED: 'text-brand',
  APPROVED: 'text-success',
  SENT_BACK: 'text-warning',
  APPROVAL_WITHDRAWN: 'text-ink-2',
};
const ACTION_DOT: Record<string, string> = {
  CREATED: 'bg-info',
  MOVED: 'bg-ink-3',
  COMPLETED: 'bg-success',
  REOPENED: 'bg-warning',
  ASSIGNED: 'bg-brand',
  APPROVAL_REQUESTED: 'bg-brand',
  APPROVED: 'bg-success',
  SENT_BACK: 'bg-warning',
};
const FILTERS: { value: ActivityKind | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'CREATED', label: 'Created' },
  { value: 'MOVED', label: 'Moved' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ASSIGNED', label: 'Assigned' },
];
/** List (the newest 50) or Calendar (1.22). */
type View = 'list' | 'calendar';
const VIEWS: { value: View; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'calendar', label: 'Calendar' },
];

const str = (v: unknown) => (typeof v === 'string' ? v : null);

function dayHeader(iso: string): string {
  const d = new Date(iso);
  const key = d.toDateString();
  if (key === new Date().toDateString()) return 'Today';
  if (key === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
  return instantDayText(d, undefined, { weekday: 'long', month: 'long' });
}

/** The task's title — for a line on no task (the old project's "moved out" line), the one it recorded. */
const titleOf = (a: ApiActivity): string => a.task?.title ?? str(a.meta?.title) ?? '';

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
    case 'APPROVED':
      return to ? `done in ${to}` : '';
    case 'SENT_BACK':
      return str(m.reason) ? `“${str(m.reason)}”` : '';
    case 'ASSIGNED':
      return str(m.assignee) ? `→ ${str(m.assignee)}` : '';
    case 'PROJECT_CHANGED': {
      // To another project: from where, by the key it had there ("from Rig Inspection (RIG-4) to Operations").
      const fromProject = str(m.fromProject);
      const toProject = str(m.toProject);
      const fromKey = str(m.fromKey);
      if (!fromProject || !toProject) return toProject ? `to ${toProject}` : 'to another project';
      return `from ${fromProject}${fromKey ? ` (${fromKey})` : ''} to ${toProject}`;
    }
    case 'PROJECT_MOVED_OUT': {
      // The old project's line, on no task: the key it had here, and where it went ("RIG-4 to Operations (OPS-17)").
      const key = str(m.key);
      const toProject = str(m.toProject);
      const toKey = str(m.toKey);
      const where = toProject ? `to ${toProject}${toKey ? ` (${toKey})` : ''}` : 'to another project';
      return key ? `${key} ${where}` : where;
    }
    case 'PROJECT_COMPANIES_CHANGED': {
      // "added Alpha Co; removed Prolens Projects LLC; main company now Alpha Co"
      const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      const list = (n: string[]) => (n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
      const added = names(m.added);
      const removed = names(m.removed);
      const main = str(m.main);
      return [added.length ? `added ${list(added)}` : null, removed.length ? `removed ${list(removed)}` : null, main ? `main company now ${main}` : null].filter(Boolean).join('; ');
    }
    default:
      return '';
  }
}

export function ActivityPage() {
  // List (the newest 50, as ever) or Calendar (1.22): remembered for this person on this browser.
  const userId = useAuthStore((s) => s.user?.id);
  const [view, setViewState] = useState<View>(() => (readUserValue(useAuthStore.getState().user?.id, ACTIVITY_VIEW_PREF) === 'calendar' ? 'calendar' : 'list'));
  const setView = (next: View) => {
    setViewState(next);
    writeUserValue(userId, ACTIVITY_VIEW_PREF, next);
  };
  const q = useQuery({ queryKey: ['activity'], queryFn: () => activityApi(apiClient).recent(), enabled: view === 'list' });
  const [filter, setFilter] = useState<ActivityKind | ''>('');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const rows = (q.data ?? []).filter(
    (a) => !filter || a.action === filter || (filter === 'COMPLETED' && (a.action === 'REOPENED' || a.action === 'APPROVED')),
  );

  const groups = useMemo(() => {
    const m = new Map<string, ApiActivity[]>();
    for (const a of rows) {
      const h = dayHeader(a.createdAt);
      (m.get(h) ?? m.set(h, []).get(h)!).push(a);
    }
    return [...m.entries()];
  }, [rows]);

  const nothingYet = view === 'list' && q.isSuccess && (q.data ?? []).length === 0 && !filter;
  const noProjectsYet = useNoProjectsYet();

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:!min-w-11 ${active ? 'bg-brand text-white shadow-brand' : 'border border-line text-ink-2 hover:bg-ground'}`;

  return (
    // A readable width on a wide screen (centred, as About): a feed line across a 1,900px window is hard to follow.
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Workspace" title="Activity" subtitle="Who did what, across your tasks and projects." />

      {/* Nothing to filter yet (the feed came back empty): no filters over an empty page. */}
      {nothingYet ? null : (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)} className={chip(filter === f.value)}>{f.label}</button>
            ))}
          </div>
          <div role="group" aria-label="View" className="ms-auto inline-flex rounded-xl border border-line bg-surface p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                aria-pressed={view === v.value}
                onClick={() => setView(v.value)}
                className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors [@media(pointer:coarse)]:h-11 ${view === v.value ? 'bg-brand text-white' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'calendar' ? (
        <ActivityCalendar
          kind={filter}
          kindLabel={FILTERS.find((f) => f.value === filter)?.label}
          renderRow={(a, timeZone) => <ActivityRow key={a.id} a={a} onOpenTask={setOpenTaskId} clockIn={timeZone} />}
        />
      ) : q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
        </div>
      ) : q.isError ? (
        <LoadError what="activity" onRetry={() => void q.refetch()} />
      ) : rows.length === 0 && filter ? (
        // The feed has entries, just none of this kind: say that, not "no activity yet".
        <EmptyState
          title={`No ${(FILTERS.find((f) => f.value === filter)?.label ?? 'matching').toLowerCase()} activity`}
          action={<Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all activity</Button>}
        />
      ) : rows.length === 0 ? (
        noProjectsYet ? (
          // A company's first day: point to the first steps.
          <EmptyState
            icon={FirstStepsIcon}
            title="No activity yet"
            description="Who created, moved, finished or assigned which task will show up here. It all starts with a project."
            action={<FirstStepsActions />}
          />
        ) : (
          <EmptyState title="No activity yet" description="Task creations, moves, completions and assignments will show up here." />
        )
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(([header, items]) => (
            <section key={header}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">{header}</h2>
              <ol className="ml-2 flex flex-col gap-1.5 border-l border-line pl-5">
                {items.map((a) => <ActivityRow key={a.id} a={a} onOpenTask={setOpenTaskId} />)}
              </ol>
            </section>
          ))}
        </div>
      )}

      {openTaskId ? <TaskDrawerContainer taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
    </div>
  );
}

/**
 * One line of the feed — who did what, to which task, with the change — in the list and in a calendar
 * day's list. `clockIn`: the time of day in that zone (a day's list) instead of "2 hours ago".
 */
function ActivityRow({ a, onOpenTask, clockIn }: { a: ApiActivity; onOpenTask: (taskId: string) => void; clockIn?: string }) {
  return (
    <li className="relative">
      <span
        className={`absolute -left-[26px] top-3 h-2.5 w-2.5 rounded-full ring-4 ring-ground ${ACTION_DOT[a.action] ?? 'bg-ink-3'}`}
        aria-hidden="true"
      />
      <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface p-2.5">
        <Avatar name={a.actor?.name ?? '?'} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-ink">
            <bdi className="font-semibold">{a.actor?.name ?? 'Someone'}</bdi>{' '}
            <span className={ACTION_TONE[a.action] ?? 'text-ink-2'}>{ACTION_VERB[a.action] ?? a.action.toLowerCase().replace(/_/g, ' ')}</span>{' '}
            {a.task ? (
              <TaskKeyButton value={a.task.key} onClick={() => onOpenTask(a.task!.id)} className="align-middle" />
            ) : PROJECT_LINES.has(a.action) && a.project ? (
              <bdi className="font-medium text-ink">{a.project.name}</bdi>
            ) : (
              <span className="text-ink-2">a task</span>
            )}
            {/* A change the person confirmed in MICO AI says so, as in the task's own history. */}
            {a.meta?.via === 'mico-ai' ? (
              <>
                {' '}
                <span className="text-xs text-ink-2">via MICO AI</span>
              </>
            ) : null}
          </p>
          {/* bdi: an Arabic task title reads right-to-left inside the line without flipping the whole line. */}
          <p title={[titleOf(a), detailOf(a), a.project?.name].filter(Boolean).join(' · ')} className="line-clamp-2 text-xs text-ink-2 sm:line-clamp-1">
            {titleOf(a) ? <bdi>{titleOf(a)}</bdi> : null}
            {detailOf(a) ? <span className="text-ink-3">{titleOf(a) ? ' · ' : ''}{detailOf(a)}</span> : null}
            {a.project ? <span className="text-ink-3">{titleOf(a) || detailOf(a) ? ' · ' : ''}<bdi>{a.project.name}</bdi></span> : null}
          </p>
        </div>
        <time className="flex-none text-xs tabular-nums text-ink-3" title={dateTimeText(a.createdAt, clockIn)} dateTime={a.createdAt}>
          {clockIn ? clockText(a.createdAt, clockIn) : relativeTime(a.createdAt)}
        </time>
      </div>
    </li>
  );
}
