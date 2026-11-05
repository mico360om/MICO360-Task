import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { taskMergeApi, type MergedFromPanel as Panel } from '../../api/task-merge';
import { dayKeyIn, instantDayText } from '../../lib/day-words';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { TaskKey } from '../TaskKey';

/** "5 Nov" (with the year when it isn't this year's). */
const when = (at: string, timeZone: string, today: string) => instantDayText(at, timeZone, { year: dayKeyIn(new Date(at), timeZone).slice(0, 4) !== today.slice(0, 4) });

/**
 * The main task's "Merged from" panel: each merge — when and by whom — and the tasks it merged (number,
 * title, project, creator, created date). Each opens its read-only merged record; Undo takes the whole
 * merge back (for whoever may: an administrator, or the manager of every project involved).
 */
export function MergedFromPanel({ panel, timeZone, today, onUndo }: { panel: Panel; timeZone: string; today: string; onUndo?: (mergeId: string) => void }) {
  const [viewing, setViewing] = useState<{ mergeId: string; taskId: string } | null>(null);
  if (panel.merges.length === 0) return null;
  return (
    <section aria-labelledby="task-merged-heading" className="rounded-xl border border-line p-3">
      <h3 id="task-merged-heading" className="eyebrow mb-2">
        Merged from
      </h3>
      <ul className="flex flex-col gap-3">
        {panel.merges.map((m) => (
          <li key={m.mergeId} className="flex flex-col gap-1.5">
            <p className="text-xs text-ink-2">
              Merged {when(m.mergedAt, timeZone, today)}
              {m.mergedByName ? ` by ${m.mergedByName}` : ''}
            </p>
            <ul className="flex flex-col gap-1">
              {m.tasks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setViewing({ mergeId: m.mergeId, taskId: t.id })}
                    className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-lg px-1.5 py-1 text-start transition-colors hover:bg-ground [@media(pointer:coarse)]:!min-h-11"
                    aria-label={`${t.key} ${t.title}: open its merged record`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <TaskKey value={t.key} />
                      <span dir="auto" className="truncate text-sm font-medium text-ink">
                        {t.title}
                      </span>
                    </span>
                    <span className="text-xs text-ink-2">
                      {t.projectName} · created {when(t.createdAt, timeZone, today)} by {t.createdByName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {m.canUndo && onUndo ? (
              <button
                type="button"
                onClick={() => onUndo(m.mergeId)}
                className="self-start rounded-lg px-1.5 py-1 text-xs font-semibold text-brand transition-colors hover:bg-ground [@media(pointer:coarse)]:!min-h-11"
              >
                Undo this merge…
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {viewing ? <MergedRecordDialog mergeId={viewing.mergeId} taskId={viewing.taskId} timeZone={timeZone} today={today} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}

const PRIORITY: Record<string, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

/** A merged task's own record, read-only: its fields as they were when it was merged. */
function MergedRecordDialog({ mergeId, taskId, timeZone, today, onClose }: { mergeId: string; taskId: string; timeZone: string; today: string; onClose: () => void }) {
  const dialogRef = useDialog(onClose);
  const q = useQuery({ queryKey: ['merged-record', mergeId, taskId], queryFn: () => taskMergeApi(apiClient).record(mergeId, taskId) });
  const r = q.data;
  const day = (d: string | null) => (d ? when(d, timeZone, today) : '—');
  const rows: [string, string][] = r
    ? [
        ['Project', r.project.name],
        ['Status', r.status.name],
        ['Priority', PRIORITY[r.priority] ?? r.priority],
        ['Start', day(r.startDate)],
        ['Due', day(r.dueDate)],
        ...(r.isMilestone ? ([['Milestone', 'Yes']] as [string, string][]) : []),
        ['Created', `${day(r.createdAt)} by ${r.createdByName}`],
        ['Merged', r.mergedAt ? `${day(r.mergedAt)}${r.mergedByName ? ` by ${r.mergedByName}` : ''} into ${r.main.key}` : r.main.key],
      ]
    : [];
  const kept = r ? [r.keptOnce.checklist ? `${r.keptOnce.checklist} checklist item${r.keptOnce.checklist === 1 ? '' : 's'}` : null, r.keptOnce.files ? `${r.keptOnce.files} file${r.keptOnce.files === 1 ? '' : 's'}` : null, r.keptOnce.contacts ? `${r.keptOnce.contacts} contact${r.keptOnce.contacts === 1 ? '' : 's'}` : null].filter(Boolean) : [];
  return (
    <ModalPortal>
      <div className={dialogLayer('small', { onTop: true })}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="merged-record-title" className={`card relative ${dialogPanel('small')} animate-scale-in overflow-y-auto p-5`}>
          <h2 id="merged-record-title" className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-ink">
            {r ? <TaskKey value={r.key} size="lg" /> : null}
            <span dir="auto">{r ? r.title : 'Merged task'}</span>
          </h2>
          {q.isLoading ? <p role="status" className="mt-2 text-sm text-ink-2">Loading…</p> : null}
          {q.isError ? (
            <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              Couldn’t load this merged task.
            </p>
          ) : null}
          {r ? (
            <>
              <p className="mt-1 text-xs text-ink-2">A read-only record: everything it held is on {r.main.key} now.</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                {rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-2">{k}</dt>
                    <dd dir="auto" className="text-ink">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
              {r.description ? (
                <div className="mt-3">
                  <p className="eyebrow mb-1">Its description</p>
                  <p dir="auto" className="whitespace-pre-wrap text-sm text-ink">
                    {r.description}
                  </p>
                </div>
              ) : null}
              {kept.length ? <p className="mt-3 text-xs text-ink-2">Kept once on {r.main.key} (the same was already there): {kept.join(', ')}.</p> : null}
            </>
          ) : null}
          <div className="mt-5 flex justify-end">
            <Button variant="secondary" onClick={onClose} shortcut="cancel">
              Close
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
