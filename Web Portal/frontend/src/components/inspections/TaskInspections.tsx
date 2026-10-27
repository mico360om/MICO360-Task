import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { inspectionsApi } from '../../api/inspections';
import { InspectIcon, OutcomePill } from './inspection-ui';
import { StartDialog, type InspectionTaskOption } from './ProjectInspectionsTab';

/**
 * A task's inspections, on its panel: those carried out for it ("Inspect rig 3"), and — for a
 * follow-up task — the inspection and item it follows up. Anyone on the team can start one for it.
 */
export function TaskInspections({ taskId, projectId, task, canStart }: { taskId: string; projectId: string; task: InspectionTaskOption; canStart: boolean }) {
  const heading = useId();
  const [starting, setStarting] = useState(false);
  const q = useQuery({ queryKey: ['task-inspections', taskId], queryFn: () => inspectionsApi(apiClient).forTask(taskId), retry: false });
  const attached = q.data?.attached ?? [];
  const of = q.data?.followUpOf ?? null;
  if (!q.data || (!attached.length && !of && !canStart)) return null;
  return (
    <section role="region" aria-labelledby={heading}>
      <h3 id={heading} className="eyebrow mb-1.5 flex items-center gap-1.5">
        {InspectIcon.clipboard}
        Inspections
      </h3>
      {of ? (
        <p className="mb-2 rounded-lg bg-ground px-2.5 py-1.5 text-xs text-ink-2">
          Follows up <bdi>“{of.item}”</bdi> from the inspection{' '}
          <Link to={`/inspections/${encodeURIComponent(of.inspection.id)}`} className="font-semibold text-brand hover:underline">
            <bdi>{of.inspection.title}</bdi>
          </Link>
        </p>
      ) : null}
      {attached.length ? (
        <ul className="flex flex-col gap-1.5">
          {attached.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5">
              <Link to={`/inspections/${encodeURIComponent(x.id)}`} className="min-w-0 break-words text-sm font-semibold text-ink hover:text-brand">
                <bdi>{x.title}</bdi>
              </Link>
              {x.status === 'FINISHED' ? <OutcomePill status="FINISHED" failed={x.counts.failed} result={x.result} /> : <span className="text-xs text-ink-2">{x.result}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {canStart ? (
        <button type="button" onClick={() => setStarting(true)} className="tap mt-1.5 text-xs font-semibold text-brand hover:underline">
          Start an inspection for this task
        </button>
      ) : null}
      {starting ? <StartDialog projectId={projectId} tasks={[task]} fixedTask={task} onClose={() => setStarting(false)} /> : null}
    </section>
  );
}
