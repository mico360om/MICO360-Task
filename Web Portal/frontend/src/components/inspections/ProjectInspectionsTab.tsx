import { useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { inspectionsApi, type InspectionListItem } from '../../api/inspections';
import { useDialog } from '../../hooks/useDialog';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { useWaitingInspections } from '../../lib/inspection-sync';
import { INSPECTION_LIMITS } from '../../lib/inspection-rules';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { ClientEyeIcon } from '../TaskCard';
import { dayText, InspectIcon, OutcomePill, problemText } from './inspection-ui';
import { DueChecksSection, SchedulesSection } from './ScheduledInspections';
import { TOUCH_TALL } from '../../lib/touch';

export interface InspectionTaskOption {
  id: string;
  key: string;
  title: string;
}

/** Where a form is made (the Templates page's "Inspection forms" tab, once it is there). */
export const INSPECTION_FORMS_PATH = '/templates?tab=inspections';

/** To the forms, for whoever can make them (administrators, and whoever runs a project). */
function ManageFormsLink({ className = '' }: { className?: string }) {
  return (
    <Link to={INSPECTION_FORMS_PATH} className={`inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-brand hover:underline sm:min-h-0 [@media(pointer:coarse)]:!min-h-11 ${className}`}>
      Manage forms
    </Link>
  );
}

const useForms = () => useQuery({ queryKey: ['inspection-forms'], queryFn: () => inspectionsApi(apiClient).listForms() });

function Row({ x, timeZone }: { x: InspectionListItem; timeZone: string }) {
  const finished = x.status === 'FINISHED';
  return (
    <li className="rounded-xl border border-line bg-surface p-3 transition-colors hover:border-brand/30 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/inspections/${encodeURIComponent(x.id)}`} className="break-words font-semibold text-ink hover:text-brand">
            <bdi>{x.title}</bdi>
          </Link>
          <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-ink-2">
            {[
              x.place ? <span dir="auto">{x.place}</span> : null,
              <span>{finished ? `Finished ${dayText(x.finishedAt, timeZone)}` : `Started ${dayText(x.startedAt, timeZone)}`}</span>,
              <bdi>{x.inspector.name}</bdi>,
              x.task ? (
                <span>
                  For <span className="font-mono">{x.task.key}</span>
                </span>
              ) : null,
            ]
              .filter(Boolean)
              .map((part, i) => (
                <span key={i} className="inline-flex gap-x-1.5">
                  {i > 0 ? <span aria-hidden="true">·</span> : null}
                  {part}
                </span>
              ))}
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-1.5">
          {finished && x.task?.lateDays ? (
            <span className="inline-flex items-center rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-warning">
              Done late · {x.task.lateDays} {x.task.lateDays === 1 ? 'day' : 'days'}
            </span>
          ) : null}
          {x.clientVisible ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5 text-xs font-semibold text-info">
              <ClientEyeIcon size={12} />
              Visible to client
            </span>
          ) : null}
          {finished ? <OutcomePill status="FINISHED" failed={x.counts.failed} result={x.result} /> : <span className="text-xs font-medium text-ink-2">{x.result}</span>}
        </div>
      </div>
      {!finished ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ground" aria-hidden="true">
          <div className="h-full rounded-full bg-brand" style={{ width: `${x.counts.total ? (x.counts.answered / x.counts.total) * 100 : 0}%` }} />
        </div>
      ) : null}
    </li>
  );
}

function Group({ title, items, timeZone, empty }: { title: string; items: InspectionListItem[]; timeZone: string; empty: string }) {
  const id = useId();
  return (
    <section role="region" aria-labelledby={id} className="card p-4 sm:p-5">
      <h2 id={id} className="eyebrow mb-3">
        {title} ({items.length})
      </h2>
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((x) => (
            <Row key={x.id} x={x} timeZone={timeZone} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-2">{empty}</p>
      )}
    </section>
  );
}

/** Starts an inspection from a form; with `fixedTask`, for that task (the task panel's button). */
export function StartDialog({ projectId, tasks, fixedTask, onClose }: { projectId: string; tasks: InspectionTaskOption[]; fixedTask?: InspectionTaskOption; onClose: () => void }) {
  const ids = { title: useId(), forms: useId(), task: useId(), place: useId() };
  const navigate = useNavigate();
  const formsQ = useForms();
  const [formId, setFormId] = useState('');
  const [taskId, setTaskId] = useState(fixedTask?.id ?? '');
  const [place, setPlace] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const startM = useMutation({
    mutationFn: () => inspectionsApi(apiClient).start(projectId, { formId, taskId: taskId || null, place: place.trim() || null }),
    onMutate: () => setProblem(null),
    onSuccess: (started) => navigate(`/inspections/${encodeURIComponent(started.id)}`),
    onError: (e) => setProblem(problemText(e, 'Couldn’t start it. Check your connection and try again.')),
  });
  const dialogRef = useDialog(startM.isPending ? () => {} : onClose);
  const forms = formsQ.data?.forms ?? [];
  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={startM.isPending ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={ids.title} className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height,100vh)-2rem)] w-full max-w-lg animate-scale-in flex-col overflow-hidden">
          <div className="border-b border-line px-5 pb-3 pt-4">
            <div className="flex items-start justify-between gap-2">
              <h2 id={ids.title} className="font-display text-lg font-semibold text-ink">
                Start an inspection
              </h2>
              {formsQ.data?.canCreate && forms.length ? <ManageFormsLink className="-me-2 -mt-1" /> : null}
            </div>
            <p className="mt-1 text-sm text-ink-2">You become its inspector. It keeps working without signal, even if the page reloads, once you’ve opened it here.</p>
          </div>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (!formId) {
                setProblem('Pick a form.');
                return;
              }
              startM.mutate();
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <fieldset>
                <legend id={ids.forms} className="text-sm font-semibold text-ink">
                  Form
                </legend>
                {formsQ.isLoading ? <p className="mt-1 text-sm text-ink-2">Loading forms…</p> : null}
                {formsQ.isError ? <p role="alert" className="mt-1 text-sm text-danger">{problemText(formsQ.error, 'Couldn’t load the forms.')}</p> : null}
                {formsQ.data && !forms.length ? (
                  <p className="mt-1 text-sm text-ink-2">
                    No inspection forms yet.{' '}
                    {formsQ.data.canCreate ? (
                      <Link to={INSPECTION_FORMS_PATH} className="font-semibold text-brand hover:underline">
                        Make a form
                      </Link>
                    ) : (
                      'Ask an administrator or whoever runs a project to make one.'
                    )}
                  </p>
                ) : null}
                <div role="radiogroup" aria-labelledby={ids.forms} className="mt-2 flex flex-col gap-1.5">
                  {forms.map((f) => (
                    <label key={f.id} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-brand/40 ${formId === f.id ? 'border-brand bg-brand/5' : 'border-line hover:bg-ground'}`}>
                      <input type="radio" name="inspection-form" value={f.id} checked={formId === f.id} onChange={() => setFormId(f.id)} className="mt-0.5 accent-[rgb(var(--c-brand))]" />
                      <span className="min-w-0">
                        <span dir="auto" className="block font-semibold text-ink">
                          {f.title}
                        </span>
                        <span className="block text-xs text-ink-2">
                          {f.sectionCount} {f.sectionCount === 1 ? 'section' : 'sections'} · {f.itemCount} {f.itemCount === 1 ? 'item' : 'items'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {fixedTask ? (
                <p className="text-sm text-ink-2">
                  For the task <span className="font-mono">{fixedTask.key}</span> <bdi>{fixedTask.title}</bdi>
                </p>
              ) : (
                <div>
                  <label htmlFor={ids.task} className="text-sm font-semibold text-ink">
                    For a task (optional)
                  </label>
                  <select id={ids.task} value={taskId} onChange={(e) => setTaskId(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-2 text-base text-ink sm:h-9 sm:text-sm [@media(pointer:coarse)]:h-11">
                    <option value="">No task</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.key} · {t.title}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-ink-2">The task shows the inspection, and finishing it offers to mark the task done.</p>
                </div>
              )}
              <div>
                <label htmlFor={ids.place} className="text-sm font-semibold text-ink">
                  Place (optional)
                </label>
                <input id={ids.place} value={place} maxLength={INSPECTION_LIMITS.placeMax} onChange={(e) => setPlace(e.target.value)} dir="auto" className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink sm:h-9 sm:text-sm [@media(pointer:coarse)]:h-11" placeholder="e.g. Rig 3, north deck" />
              </div>
              {problem ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {problem}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={startM.isPending} className={TOUCH_TALL}>
                Cancel
              </Button>
              <Button type="submit" loading={startM.isPending} className={TOUCH_TALL}>
                Start
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * A project's inspections: the checks due (late ones first) and the schedules that make them, then
 * those in progress (with how far along) and finished ones (with their result, the task they were
 * for, whether it was done late, and whether the client sees them); anyone on the team starts one
 * from a form or schedules one. Inspections with changes still on this phone are named, so nobody
 * wonders where they went.
 */
export function ProjectInspectionsTab({ projectId, tasks, onOpenTask }: { projectId: string; tasks: InspectionTaskOption[]; onOpenTask?: (taskId: string) => void }) {
  const timeZone = useCompanyTimeZone();
  const [starting, setStarting] = useState(false);
  const q = useQuery({ queryKey: ['project-inspections', projectId], queryFn: () => inspectionsApi(apiClient).listForProject(projectId) });
  const formsQ = useForms();
  const waiting = useWaitingInspections().filter((w) => w.projectId === projectId);
  const all = useMemo(() => q.data?.inspections ?? [], [q.data]);
  const inProgress = all.filter((x) => x.status === 'IN_PROGRESS');
  const finished = all.filter((x) => x.status === 'FINISHED');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-ink-2">
          {InspectIcon.clipboard}
          Checklists carried out on this project, with their reports.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {formsQ.data?.canCreate ? <ManageFormsLink /> : null}
          {q.data?.canStart ? <Button onClick={() => setStarting(true)} className={TOUCH_TALL}>Start an inspection</Button> : null}
        </div>
      </div>
      {waiting.length ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
          <span className="mt-0.5 flex-none">{InspectIcon.phone}</span>
          <span>
            {waiting.length === 1 ? '1 inspection has' : `${waiting.length} inspections have`} changes saved on this phone, waiting to be sent: {waiting.map((w) => w.title).join(', ')}.
          </span>
        </p>
      ) : null}
      {q.isLoading ? <div className="skeleton h-28 rounded-xl" aria-label="Loading inspections" /> : null}
      {q.isError ? (
        <p role="alert" className="text-danger">
          {problemText(q.error, 'Couldn’t load the inspections.')}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      {q.data ? (
        <>
          <DueChecksSection projectId={projectId} canStart={q.data.canStart} onOpenTask={onOpenTask} />
          <SchedulesSection projectId={projectId} canChange={q.data.canStart} />
          <Group title="In progress" items={inProgress} timeZone={timeZone} empty="None in progress." />
          <Group title="Finished" items={finished} timeZone={timeZone} empty="No finished inspections yet." />
        </>
      ) : null}
      {starting ? <StartDialog projectId={projectId} tasks={tasks} onClose={() => setStarting(false)} /> : null}
    </div>
  );
}
