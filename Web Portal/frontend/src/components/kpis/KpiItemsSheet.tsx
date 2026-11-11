import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { KpiItemRow, KpiItems } from '../../api/kpis';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { LoadError } from '../ui/LoadError';
import { TaskKey } from '../TaskKey';
import { HEALTH_CLASS } from '../../lib/colour-classes';

/** A row's words in the one scheme's tones: on time = on track, late = late. */
const TONE: Record<KpiItemRow['tone'], string> = {
  success: HEALTH_CLASS.ON_TRACK.text,
  danger: HEALTH_CLASS.LATE.text,
  warning: HEALTH_CLASS.AT_RISK.text,
  neutral: 'text-ink-2',
};
const ROW = 'flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-ground focus-visible:bg-ground [@media(pointer:coarse)]:!min-h-11';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The list behind a KPI's number, in a side sheet: the tasks (approvals, action items) it was counted
 * from, by the same rules, worst first. A task opens in the task panel; an action item its meeting.
 */
export function KpiItemsSheet({ title, queryKey, load, onClose, onOpenTask }: { title: string; queryKey: readonly unknown[]; load: () => Promise<KpiItems>; onClose: () => void; onOpenTask: (id: string) => void }) {
  const titleId = useId();
  const dialogRef = useDialog<HTMLDivElement>(onClose, { initialFocus: 'container' });
  const q = useQuery({ queryKey, queryFn: load });
  const data = q.data;

  const body = (row: KpiItemRow) => (
    <>
      <span className="flex min-w-0 items-baseline gap-2">
        {row.key ? <TaskKey value={row.key} /> : null}
        <span className="min-w-0 truncate text-sm font-medium text-ink" title={row.title}>
          <bdi>{row.title}</bdi>
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-2 text-xs text-ink-2">
        {row.project ? <bdi className="truncate" title={row.project.name}>{row.project.name}</bdi> : null}
        {row.peopleNames.length ? <bdi className="truncate" title={row.peopleNames.join(', ')}>{row.peopleNames.join(', ')}</bdi> : null}
      </span>
      <span className={`block text-xs font-medium ${TONE[row.tone]}`}>
        <bdi>{row.detail}</bdi>
      </span>
    </>
  );

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-40 flex justify-end bg-scrim animate-fade-in" onClick={onClose}>
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
                <bdi>{title}</bdi>
              </h2>
              <p className="text-sm text-ink-2" role="status">
                {data ? (data.total ? plural(data.total, data.metric === 'actionItems' ? 'action item' : data.metric === 'approvalTurnaround' ? 'decision' : 'task') : 'Nothing here.') : q.isLoading ? 'Loading…' : ''}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
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
                {data.rows.map((row, i) => (
                  <li key={`${row.kind}-${row.id}-${i}`}>
                    {row.kind === 'task' ? (
                      <button type="button" className={ROW} onClick={() => onOpenTask(row.id)}>
                        {body(row)}
                      </button>
                    ) : row.meetingId ? (
                      <Link className={ROW} to={`/meetings/${encodeURIComponent(row.meetingId)}`}>
                        {body(row)}
                      </Link>
                    ) : (
                      <div className={ROW}>{body(row)}</div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-ink-2">Nothing to list.</p>
            )}
          </div>
          {data && data.total > data.rows.length ? <p className="border-t border-line px-4 py-2 text-xs text-ink-2">Showing the first {data.rows.length} of {data.total}.</p> : null}
        </div>
      </div>
    </ModalPortal>
  );
}
