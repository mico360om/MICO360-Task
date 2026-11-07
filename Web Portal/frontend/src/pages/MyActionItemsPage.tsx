import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { meetingsApi, ACTION_STATUS_LABELS, type ActionItem, type ActionItemStatus } from '../api/meetings';
import { apiClient } from '../api/client';
import { ApiError } from '../lib/api-client';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { fieldClass } from '../components/ui/Field';
import { formatDueDate, isActionItemOverdue } from '../lib/meetingFormat';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { Icon } from '../components/meeting/kit';
import { TOUCH_TALL } from '../lib/touch';
import { TaskKeyButton } from '../components/TaskKey';
import { useOpenTask } from '../lib/useOpenTask';
import { DENSE_TEXT } from '../lib/density-tokens';
import { OVERDUE_CLASS } from '../lib/colour-classes';

/**
 * A row: one column on a phone (the words, where it came from, the status picker under them); the
 * picker beside them from 40em; and on a laptop, columns — item, meeting, due, status — so a short
 * list fills its width with things to read instead of a gap between the words and the picker.
 */
const ROW = 'grid grid-cols-1 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center sm:gap-x-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,18rem)_8rem_11rem] lg:gap-x-6';

const ACTION_STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
type Scope = 'open' | 'all';

export function MyActionItemsPage() {
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const [scope, setScope] = useState<Scope>('open');
  const [statusError, setStatusError] = useState<string | null>(null);
  const openTask = useOpenTask();

  const itemsQ = useQuery({
    queryKey: ['my-action-items', scope],
    queryFn: () => meetingsApi(apiClient).listMyActionItems({ openOnly: scope === 'open' }),
  });
  const meetingsQ = useQuery({ queryKey: ['meetings', 'all'], queryFn: () => meetingsApi(apiClient).list() });

  const meetingTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of Array.isArray(meetingsQ.data) ? meetingsQ.data : []) map.set(m.id, m.title);
    return map;
  }, [meetingsQ.data]);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ActionItemStatus }) => meetingsApi(apiClient).updateActionItem(id, { status }),
    onSuccess: () => { setStatusError(null); void qc.invalidateQueries({ queryKey: ['my-action-items'] }); },
    onError: (err) =>
      setStatusError(
        err instanceof ApiError && err.status === 403
          ? 'Couldn’t change the status — you don’t have permission to update that action item.'
          : 'Couldn’t change the status. Please try again.',
      ),
  });

  const items = Array.isArray(itemsQ.data) ? itemsQ.data : [];
  // Overdue by calendar day in the company time zone: an item due today is not overdue yet.
  const overdue = items.filter((i) => isActionItemOverdue(i, timeZone)).length;

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="My Action Items"
        subtitle="Everything assigned to you across meetings — with due dates and status in one place."
        actions={
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {(['open', 'all'] as Scope[]).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${TOUCH_TALL} ${scope === s ? 'bg-brand-gradient text-white shadow-sm' : 'text-ink-2 hover:text-ink'}`}>
                {s === 'open' ? 'Open' : 'All'}
              </button>
            ))}
          </div>
        }
      />

      {statusError ? (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>{statusError}</span>
          <button onClick={() => setStatusError(null)} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {overdue > 0 ? (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm font-medium ${OVERDUE_CLASS.chip}`}>
          {overdue} action item{overdue === 1 ? '' : 's'} overdue.
        </div>
      ) : null}

      {itemsQ.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-16 p-4"><div className="skeleton h-4 w-64" /></div>)}</div>
      ) : itemsQ.isError ? (
        <div className="card p-5">
          <p role="alert" className="text-sm text-danger">
            Couldn’t load your action items.{' '}
            <button type="button" onClick={() => void itemsQ.refetch()} className="font-semibold underline">Retry</button>
          </p>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing on your plate"
          description={`${scope === 'open' ? 'You have no open action items.' : 'No action items are assigned to you yet.'} An action item shows up here when it’s assigned to you in a meeting.`}
          action={
            <Link to="/meetings" className={`inline-flex items-center rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-ground ${TOUCH_TALL}`}>
              Go to Meetings
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          {/* The column names, for the eye; each row's link and picker carry their own names. */}
          <div aria-hidden="true" className={`${ROW} hidden border-b border-line py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-2 lg:grid`}>
            <span>Action item</span>
            <span>Meeting</span>
            <span>Due</span>
            <span>Status</span>
          </div>
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <ActionRow
                key={item.id}
                item={item}
                overdue={isActionItemOverdue(item, timeZone)}
                timeZone={timeZone}
                meetingName={item.meetingId ? meetingTitle.get(item.meetingId) ?? null : null}
                onStatus={(status) => statusMut.mutate({ id: item.id, status })}
                onOpenTask={openTask}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActionRow({
  item,
  overdue,
  timeZone,
  meetingName,
  onStatus,
  onOpenTask,
}: {
  item: ActionItem;
  overdue: boolean;
  timeZone: string;
  meetingName: string | null;
  onStatus: (s: ActionItemStatus) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const done = item.status === 'COMPLETED' || item.status === 'CANCELLED';
  return (
    // Compact rows (1.23.0, lib/density): a third less padding, the words a step smaller.
    <li className={`${ROW} compact:gap-y-1 compact:py-2`}>
      {/* bdi: an Arabic description reads right-to-left but stays on the row's side. 1.22.3: the linked
          task's number first, as the chip that opens the task in the panel. */}
      <p className={`min-w-0 text-sm font-medium [overflow-wrap:anywhere] ${DENSE_TEXT} ${done ? 'text-ink-3 line-through' : 'text-ink'}`}>
        {item.taskId && item.taskKey ? <TaskKeyButton value={item.taskKey} title={item.description} onClick={() => onOpenTask(item.taskId!)} className="me-1.5 align-middle" /> : null}
        <bdi>{item.description}</bdi>
      </p>
      {/* Where it came from and when it's due: one line under the words; their own columns on a laptop. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:col-start-1 sm:row-start-2 lg:contents">
        {item.meetingId ? (
          <Link to={`/meetings/${item.meetingId}`} title={meetingName ?? undefined} className="tap inline-flex min-w-0 max-w-full items-center gap-1.5 text-ink-2 hover:text-brand lg:text-sm">
            <span className="flex-none text-ink-3">{Icon.calendar}</span>
            <bdi className="truncate">{meetingName ?? 'meeting'}</bdi>
          </Link>
        ) : (
          <span className="text-ink-3 lg:text-sm">Not from a meeting</span>
        )}
        <span className={`whitespace-nowrap lg:text-sm ${overdue ? `font-medium ${OVERDUE_CLASS.text}` : item.dueDate ? 'text-ink-2' : 'text-ink-3'}`}>
          {item.dueDate ? `Due ${formatDueDate(item.dueDate, timeZone)}${overdue ? ' · overdue' : ''}` : 'No due date'}
        </span>
      </div>
      <select
        aria-label={`Status for ${item.description}`}
        value={item.status}
        onChange={(e) => onStatus(e.target.value as ActionItemStatus)}
        className={`${fieldClass(false)} !py-1.5 text-sm sm:col-start-2 sm:row-span-2 sm:row-start-1 lg:col-start-auto lg:row-span-1 lg:row-start-auto`}
      >
        {ACTION_STATUSES.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABELS[s]}</option>)}
      </select>
    </li>
  );
}
