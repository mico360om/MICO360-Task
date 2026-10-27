import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { managementApi, managementItemsKey, type ItemMetric, type ItemQuery, type ItemRow, type ManagementFilters } from '../../api/management';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { LoadError } from '../ui/LoadError';
import { shortDay } from '../../lib/management';
import { plural } from './parts';

const TONE: Record<NonNullable<ItemRow['tone']>, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
  neutral: 'text-ink-2',
};
const ROW = 'flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-ground focus-visible:bg-ground [@media(pointer:coarse)]:!min-h-11';
/** What a list counts, in words ("4 tasks", "1 day"). */
const UNIT: Record<ItemMetric, [string, string]> = {
  'late-tasks': ['task', 'tasks'],
  'late-milestones': ['milestone', 'milestones'],
  'missing-checks': ['check', 'checks'],
  'checks-due': ['check', 'checks'],
  'checks-done': ['check', 'checks'],
  'checks-done-late': ['check', 'checks'],
  'checks-no-report': ['check', 'checks'],
  'follow-ups': ['task', 'tasks'],
  inspections: ['inspection', 'inspections'],
  'failed-item': ['inspection', 'inspections'],
  'failed-form': ['failed item', 'failed items'],
  'person-overloaded': ['day', 'days'],
  'person-actions': ['action item', 'action items'],
  'overdue-actions': ['action item', 'action items'],
  projects: ['project', 'projects'],
  'people-overloaded': ['person', 'people'],
};

/** "Finished Wed 21 Oct, 12:00" in the company time zone. */
function finishedText(at: string, timeZone: string): string {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `Finished ${shortDay(day)}, ${time}`;
}

function RowBody({ row, timeZone }: { row: ItemRow; timeZone: string }) {
  const due = row.daysLate ? `${plural(row.daysLate, 'day')} late` : row.due ? `Due ${shortDay(row.due)}` : null;
  return (
    <>
      <span className="flex min-w-0 items-baseline gap-2">
        {row.key ? <span className="flex-none font-mono text-xs text-ink-3">{row.key}</span> : null}
        <span className="min-w-0 truncate text-sm font-medium text-ink" title={row.title}>
          <bdi>{row.title}</bdi>
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-2 text-xs text-ink-2">
        {row.project ? <bdi className="truncate" title={row.project.name}>{row.project.name}</bdi> : null}
        {due ? <span className={row.daysLate ? 'font-semibold text-danger' : ''}>{due}</span> : null}
        {row.at ? <span>{finishedText(row.at, timeZone)}</span> : null}
        {row.people?.length ? <bdi className="truncate" title={row.people.join(', ')}>{row.people.join(', ')}</bdi> : null}
      </span>
      {row.detail ? (
        <span className={`block text-xs font-medium ${TONE[row.tone ?? 'neutral']}`}>
          <bdi>{row.detail}</bdi>
        </span>
      ) : null}
    </>
  );
}

/**
 * The list behind a number, in a side sheet: what the number counts, with the same filters (so a
 * number N opens N rows). A task opens in the task panel; an inspection, a meeting's action item or a
 * project opens its page; a person or an overloaded day opens the Workload page on the counted week.
 */
export function ItemsSheet({
  filters,
  query,
  label,
  timeZone,
  workloadWeek,
  onClose,
  onOpenTask,
}: {
  filters: ManagementFilters;
  query: ItemQuery;
  label: string;
  timeZone: string;
  /** The company week the people figures count (the Workload page shows exactly those days). */
  workloadWeek: string;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const titleId = useId();
  const dialogRef = useDialog<HTMLDivElement>(onClose, { initialFocus: 'container' });
  const q = useQuery({ queryKey: managementItemsKey(filters, query), queryFn: () => managementApi(apiClient).items(filters, query) });
  const data = q.data;
  const unit = UNIT[query.metric] ?? ['item', 'items'];
  const workload = `/workload?week=${encodeURIComponent(workloadWeek)}`;

  const open = (row: ItemRow) => {
    const body = <RowBody row={row} timeZone={timeZone} />;
    if (row.kind === 'task') return <button type="button" className={ROW} onClick={() => onOpenTask(row.id)}>{body}</button>;
    if (row.kind === 'inspection') return <Link className={ROW} to={`/inspections/${encodeURIComponent(row.inspectionId ?? row.id)}`}>{body}</Link>;
    if (row.kind === 'project') return <Link className={ROW} to={`/projects/${encodeURIComponent(row.id)}`}>{body}</Link>;
    if (row.kind === 'person') return <Link className={ROW} to={workload}>{body}</Link>;
    if (row.kind === 'day') {
      return (
        <div>
          <Link className={ROW} to={workload}>{body}</Link>
          {row.tasks?.length ? (
            <ul className="mb-2 ms-3 flex flex-col gap-0.5" aria-label={`Tasks due ${row.title}`}>
              {row.tasks.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1 text-start text-sm hover:bg-ground [@media(pointer:coarse)]:!min-h-11">
                    <span className="flex-none font-mono text-xs text-ink-3">{t.key}</span>
                    <span className="min-w-0 truncate text-ink" title={t.title}>
                      <bdi>{t.title}</bdi>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    if (row.meetingId) return <Link className={ROW} to={`/meetings/${encodeURIComponent(row.meetingId)}`}>{body}</Link>;
    if (row.taskId) return <button type="button" className={ROW} onClick={() => onOpenTask(row.taskId!)}>{body}</button>;
    return <div className={ROW}>{body}</div>;
  };

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-40 flex justify-end bg-ink/40 animate-fade-in" onClick={onClose}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="flex h-full w-full max-w-md flex-col border-s border-line bg-surface shadow-lift outline-none animate-slide-in-right"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-4">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
                <bdi>{data?.title ?? label}</bdi>
              </h2>
              <p className="text-sm text-ink-2" role="status">
                {data ? (data.total ? `${data.total} ${data.total === 1 ? unit[0] : unit[1]}` : 'Nothing here now.') : q.isLoading ? 'Loading…' : ''}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {q.isLoading ? (
              <div aria-hidden="true" className="space-y-2 p-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton h-12 rounded-lg" />
                ))}
              </div>
            ) : q.isError ? (
              <LoadError what="this list" onRetry={() => void q.refetch()} className="p-3" />
            ) : data && data.rows.length ? (
              <ul className="divide-y divide-line">
                {data.rows.map((row) => (
                  <li key={`${row.kind}-${row.id}-${row.detail ?? ''}`}>{open(row)}</li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-ink-2">Nothing to list.</p>
            )}
          </div>
          {data && data.total > data.rows.length ? (
            <p className="border-t border-line px-4 py-2 text-xs text-ink-2">Showing the first {data.rows.length} of {data.total}.</p>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  );
}
