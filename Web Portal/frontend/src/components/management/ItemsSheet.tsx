import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { managementApi, managementItemsKey, type ItemQuery, type ItemRow, type ManagementFilters } from '../../api/management';
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
        <span dir="auto" className="min-w-0 truncate text-sm font-medium text-ink">{row.title}</span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-2 text-xs text-ink-2">
        {row.project ? <bdi className="truncate">{row.project.name}</bdi> : null}
        {due ? <span className={row.daysLate ? 'font-semibold text-danger' : ''}>{due}</span> : null}
        {row.at ? <span>{finishedText(row.at, timeZone)}</span> : null}
        {row.people?.length ? <bdi className="truncate">{row.people.join(', ')}</bdi> : null}
      </span>
      {row.detail ? (
        <span dir="auto" className={`text-xs font-medium ${TONE[row.tone ?? 'neutral']}`}>
          {row.detail}
        </span>
      ) : null}
    </>
  );
}

/**
 * The list behind a number, in a side sheet: what the number counts, with the same filters. A task
 * opens in the task panel; an inspection, a meeting's action item, a project or a person opens its page.
 */
export function ItemsSheet({ filters, query, label, timeZone, onClose, onOpenTask }: { filters: ManagementFilters; query: ItemQuery; label: string; timeZone: string; onClose: () => void; onOpenTask: (id: string) => void }) {
  const titleId = useId();
  const dialogRef = useDialog<HTMLDivElement>(onClose, { initialFocus: 'container' });
  const q = useQuery({ queryKey: managementItemsKey(filters, query), queryFn: () => managementApi(apiClient).items(filters, query) });
  const data = q.data;

  const open = (row: ItemRow) => {
    if (row.kind === 'task') return <button type="button" className={ROW} onClick={() => onOpenTask(row.id)}><RowBody row={row} timeZone={timeZone} /></button>;
    if (row.kind === 'inspection') return <Link className={ROW} to={`/inspections/${encodeURIComponent(row.id)}`}><RowBody row={row} timeZone={timeZone} /></Link>;
    if (row.kind === 'project') return <Link className={ROW} to={`/projects/${encodeURIComponent(row.id)}`}><RowBody row={row} timeZone={timeZone} /></Link>;
    if (row.kind === 'person') return <Link className={ROW} to="/workload"><RowBody row={row} timeZone={timeZone} /></Link>;
    if (row.meetingId) return <Link className={ROW} to={`/meetings/${encodeURIComponent(row.meetingId)}`}><RowBody row={row} timeZone={timeZone} /></Link>;
    if (row.taskId) return <button type="button" className={ROW} onClick={() => onOpenTask(row.taskId!)}><RowBody row={row} timeZone={timeZone} /></button>;
    return <div className={ROW}><RowBody row={row} timeZone={timeZone} /></div>;
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
              <h2 id={titleId} dir="auto" className="font-display text-lg font-semibold text-ink">{data?.title ?? label}</h2>
              <p className="text-sm text-ink-2" role="status">{data ? (data.total ? plural(data.total, 'item') : 'Nothing here now.') : q.isLoading ? 'Loading…' : ''}</p>
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
