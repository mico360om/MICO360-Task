import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { inspectionsApi, type FormRef, type InspectionListItem } from '../../api/inspections';
import { Button } from '../ui/Button';
import { InspectIcon, OutcomePill, problemText } from './inspection-ui';
import { StartDialog, type InspectionTaskOption } from './ProjectInspectionsTab';
import { TOUCH_TALL } from '../../lib/touch';

const primaryLink =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-3 py-1.5 text-sm font-semibold text-white shadow-brand transition-all hover:-translate-y-0.5 hover:shadow-lift [@media(pointer:coarse)]:min-h-11';

/** A check's form and its one main button: Start inspection, Continue inspection, or View report. */
function CheckForm({ form, place, taskId, projectId, attached, canStart }: { form: FormRef; place: string | null; taskId: string; projectId: string; attached: InspectionListItem[]; canStart: boolean }) {
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const startM = useMutation({
    mutationFn: () => inspectionsApi(apiClient).start(projectId, { formId: form.id, taskId, place }),
    onMutate: () => setProblem(null),
    onSuccess: (started) => navigate(`/inspections/${encodeURIComponent(started.id)}`),
    onError: (e) => setProblem(problemText(e, 'Couldn’t start it. Check your connection and try again.')),
  });
  const inProgress = attached.find((x) => x.status === 'IN_PROGRESS');
  const finished = attached.find((x) => x.status === 'FINISHED');
  return (
    <div className="mb-2 rounded-xl border border-brand/25 bg-brand/5 p-3">
      <p className="text-xs text-ink-2">Carried out with the form</p>
      <p className="font-semibold text-ink">
        <bdi>{form.title}</bdi>
        {place ? (
          <span className="font-normal text-ink-2">
            {' '}
            · <span dir="auto">{place}</span>
          </span>
        ) : null}
      </p>
      {form.deleted ? <p className="mt-0.5 text-xs text-ink-2">Form deleted — this check can still be done.</p> : null}
      <div className="mt-2">
        {inProgress ? (
          <Link to={`/inspections/${encodeURIComponent(inProgress.id)}`} className={primaryLink}>
            Continue inspection
          </Link>
        ) : finished ? (
          <Link to={`/inspections/${encodeURIComponent(finished.id)}`} className={primaryLink}>
            View report
          </Link>
        ) : canStart ? (
          <Button size="sm" onClick={() => startM.mutate()} loading={startM.isPending} className={TOUCH_TALL}>
            Start inspection
          </Button>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A task's inspections, on its panel: those carried out for it ("Inspect rig 3"), and — for a
 * follow-up task — the inspection and item it follows up. Anyone on the team can start one for it.
 * A task that carries a form (a check) names its form and has one main button: Start inspection
 * (form, place and task filled in), Continue inspection while one is in progress, or View report.
 */
export function TaskInspections({
  taskId,
  projectId,
  task,
  canStart,
  form,
  place,
}: {
  taskId: string;
  projectId: string;
  task: InspectionTaskOption;
  canStart: boolean;
  /** The form the task carries (a check); null when it carries none. */
  form?: FormRef | null;
  /** Where the check is done. */
  place?: string | null;
}) {
  const heading = useId();
  const [starting, setStarting] = useState(false);
  const q = useQuery({ queryKey: ['task-inspections', taskId], queryFn: () => inspectionsApi(apiClient).forTask(taskId), retry: false });
  const attached = q.data?.attached ?? [];
  const of = q.data?.followUpOf ?? null;
  if (!q.data || (!attached.length && !of && !canStart && !form)) return null;
  return (
    <section role="region" aria-labelledby={heading}>
      <h3 id={heading} className="eyebrow mb-1.5 flex items-center gap-1.5">
        {InspectIcon.clipboard}
        Inspections
      </h3>
      {form ? <CheckForm form={form} place={place ?? null} taskId={taskId} projectId={projectId} attached={attached} canStart={canStart} /> : null}
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
      {/* Another inspection for it (a check that has none yet has its own button above). */}
      {canStart && !(form && !attached.length) ? (
        <button type="button" onClick={() => setStarting(true)} className={`tap mt-1.5 text-xs font-semibold text-brand hover:underline ${TOUCH_TALL}`}>
          {form ? 'Start another inspection' : 'Start an inspection for this task'}
        </button>
      ) : null}
      {starting ? <StartDialog projectId={projectId} tasks={[task]} fixedTask={task} onClose={() => setStarting(false)} /> : null}
    </section>
  );
}
