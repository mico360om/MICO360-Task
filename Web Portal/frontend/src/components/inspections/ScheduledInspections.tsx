import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { inspectionsApi, type DueCheck, type InspectionSchedule, type Person } from '../../api/inspections';
import { tasksApi } from '../../api/tasks';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { todayKey } from '../../lib/due-date';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { dueText, lateText, shortDay, upcomingText } from '../../lib/inspection-schedule';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { dayText, InspectIcon, problemText } from './inspection-ui';
import { isStaleSchedule, ScheduleDialog } from './ScheduleDialog';
import { TOUCH_TALL } from '../../lib/touch';

/** The query keys of a project's scheduled inspections (under the tab's own key, so they refresh with it). */
export const scheduleKeys = {
  schedules: (projectId: string) => ['project-inspections', projectId, 'schedules'] as const,
  checks: (projectId: string) => ['project-inspections', projectId, 'checks'] as const,
};

const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
/** 44px tall on a touch screen (see lib/touch.ts for why it is forced). */
const coarse = TOUCH_TALL;

/** Who does the checks: their pictures, named for a screen reader. */
function Inspectors({ people }: { people: Person[] }) {
  if (!people.length) return <span className="text-ink-3">No inspector</span>;
  return (
    <span role="img" aria-label={`Inspectors: ${listNames(people.map((p) => p.name))}`} className="inline-flex items-center gap-1">
      <span aria-hidden="true" className="flex -space-x-1.5">
        {people.slice(0, 3).map((p) => (
          <Avatar key={p.id} name={p.name} size="sm" />
        ))}
      </span>
      <span aria-hidden="true" dir="auto" className="max-w-[10rem] truncate">
        {people.length === 1 ? people[0]!.name : `${people[0]!.name} +${people.length - 1}`}
      </span>
    </span>
  );
}

/** A line of facts, "·" between them. */
function Facts({ children }: { children: ReactNode[] }) {
  const parts = children.filter(Boolean);
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-2">
      {parts.map((part, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-x-1.5">
          {i > 0 ? <span aria-hidden="true">·</span> : null}
          {part}
        </span>
      ))}
    </p>
  );
}

function FormName({ form }: { form: DueCheck['form'] }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="flex-none text-ink-3">{InspectIcon.clipboard}</span>
      <bdi className="truncate">{form.title}</bdi>
    </span>
  );
}

function Section({ title, count, action, children }: { title: string; count: number | null; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section role="region" aria-labelledby={id} className="card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="eyebrow">
          {title}
          {count !== null ? ` (${count})` : ''}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CheckRow({ c, today, canStart, onOpenTask, onStart, starting }: { c: DueCheck; today: string; canStart: boolean; onOpenTask?: (taskId: string) => void; onStart: (c: DueCheck) => void; starting: boolean }) {
  const late = c.state === 'LATE';
  return (
    <li className={`rounded-xl border bg-surface p-3 sm:p-4 ${late ? 'border-danger/40' : 'border-line'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {onOpenTask ? (
            <button type="button" onClick={() => onOpenTask(c.taskId)} className={`text-start font-semibold text-ink hover:text-brand hover:underline ${coarse}`}>
              <bdi>{c.title}</bdi>
            </button>
          ) : (
            <span className="font-semibold text-ink">
              <bdi>{c.title}</bdi>
            </span>
          )}
          <Facts>
            {[
              <span className="font-mono">{c.key}</span>,
              c.place ? <span dir="auto">{c.place}</span> : null,
              <FormName form={c.form} />,
            ]}
          </Facts>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {late ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 font-semibold text-danger">{lateText(c.daysLate)}</span>
            ) : (
              <span className={c.dueDate === today ? 'font-semibold text-ink' : 'text-ink-2'}>{c.dueDate === today ? dueText(c.dueDate, today) : upcomingText(c.dueDate, today)}</span>
            )}
            <span className="text-ink-2">
              <Inspectors people={c.assignees} />
            </span>
            {c.inProgress ? (
              <span className="text-info">
                <bdi>{c.inProgress.inspector.name}</bdi> is doing it
              </span>
            ) : null}
          </div>
          {c.form.deleted ? <p className="mt-1 text-xs text-ink-2">Form deleted — this check can still be done.</p> : null}
        </div>
        <div className="flex flex-none items-center gap-2">
          {c.inProgress ? (
            <Link
              to={`/inspections/${encodeURIComponent(c.inProgress.inspectionId)}`}
              aria-label={`Continue ${c.title}`}
              className={`inline-flex items-center justify-center rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:border-brand/30 hover:bg-ground ${coarse}`}
            >
              Continue
            </Link>
          ) : canStart ? (
            <Button size="sm" onClick={() => onStart(c)} loading={starting} aria-label={`Start ${c.title}`} className={coarse}>
              Start
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** A group of the due checks list, named for a screen reader and on screen. */
function CheckGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="mt-3 first:mt-0">
      <h3 id={id} className="mb-1.5 text-xs font-semibold text-ink-2">
        {label}
      </h3>
      <ul aria-labelledby={id} className="flex flex-col gap-2">
        {children}
      </ul>
    </div>
  );
}

/** Open checks, late ones first ("2 days late" in the danger colour), then due today, then upcoming. */
export function DueChecksSection({ projectId, canStart, onOpenTask }: { projectId: string; canStart: boolean; onOpenTask?: (taskId: string) => void }) {
  const navigate = useNavigate();
  const timeZone = useCompanyTimeZone();
  const today = todayKey(timeZone);
  const q = useQuery({ queryKey: scheduleKeys.checks(projectId), queryFn: () => inspectionsApi(apiClient).dueChecks(projectId) });
  const [problem, setProblem] = useState<string | null>(null);
  const startM = useMutation({
    mutationFn: (c: DueCheck) => inspectionsApi(apiClient).start(projectId, { formId: c.form.id, taskId: c.taskId, place: c.place }),
    onMutate: () => setProblem(null),
    onSuccess: (started) => navigate(`/inspections/${encodeURIComponent(started.id)}`),
    onError: (e) => setProblem(problemText(e, 'Couldn’t start it. Check your connection and try again.')),
  });
  const checks = q.data?.checks ?? [];
  return (
    <Section title="Due checks" count={q.data ? q.data.total : null}>
      {q.isLoading ? <div className="skeleton h-16 rounded-xl" role="status" aria-label="Loading due checks" /> : null}
      {q.isError ? (
        <p role="alert" className="text-sm text-danger">
          {problemText(q.error, 'Couldn’t load the due checks.')}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mb-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {problem}
        </p>
      ) : null}
      {q.data && !checks.length ? <p className="text-sm text-ink-2">No checks are due. Scheduled checks appear here on their day.</p> : null}
      {/* Late, due today, then upcoming: a check made ahead of its day (a schedule starting later) isn't due yet. */}
      {(
        [
          ['Late', checks.filter((c) => c.state === 'LATE')],
          ['Due today', checks.filter((c) => c.state !== 'LATE' && c.dueDate === today)],
          ['Upcoming', checks.filter((c) => c.state !== 'LATE' && c.dueDate !== today)],
        ] as const
      ).map(([label, group]) =>
        group.length ? (
          <CheckGroup key={label} label={label}>
            {group.map((c) => (
              <CheckRow key={c.taskId} c={c} today={today} canStart={canStart} onOpenTask={onOpenTask} onStart={(x) => startM.mutate(x)} starting={startM.isPending && startM.variables?.taskId === c.taskId} />
            ))}
          </CheckGroup>
        ) : null,
      )}
      {q.data && q.data.total > checks.length ? <p className="mt-2 text-xs text-ink-2">Showing the first {checks.length} of {q.data.total}.</p> : null}
    </Section>
  );
}

function ScheduleRow({ s, timeZone, canChange, onEdit, onStop }: { s: InspectionSchedule; timeZone: string; canChange: boolean; onEdit: () => void; onStop: () => void }) {
  return (
    <li className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">
            <bdi>{s.title}</bdi>
          </p>
          <Facts>{[<FormName form={s.form} />, s.place ? <span dir="auto">{s.place}</span> : null, <span className="text-ink-2"><Inspectors people={s.assignees} /></span>]}</Facts>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand">{s.repeat}</span>
            {s.nextDue ? <span>Next due {shortDay(s.nextDue)}</span> : s.paused ? <span>Paused</span> : s.onSchedule !== false ? <span>No more checks</span> : null}
            <span>{s.lastDone ? `Last done ${dayText(s.lastDone, timeZone)}` : 'Not done yet'}</span>
            {s.lateChecks > 0 ? <span className="rounded-md bg-danger-soft px-1.5 py-0.5 font-semibold text-danger">{s.lateChecks} late</span> : null}
          </div>
        </div>
        {canChange ? (
          <div className="flex flex-none items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Edit ${s.title}`} className={coarse}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onStop} aria-label={`Stop ${s.title}`} className={`!text-danger hover:!text-danger ${coarse}`}>
              Stop
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The project's schedules (repeating checks), to set up, change and stop — anyone on the team. */
export function SchedulesSection({ projectId, canChange }: { projectId: string; canChange: boolean }) {
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const q = useQuery({ queryKey: scheduleKeys.schedules(projectId), queryFn: () => inspectionsApi(apiClient).schedules(projectId) });
  const [editing, setEditing] = useState<{ schedule: InspectionSchedule | null } | null>(null);
  const [stopping, setStopping] = useState<InspectionSchedule | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const STALE = 'This schedule changed — check it again.';
  const stopM = useMutation({
    // Only on the series' newest copy, as the list showed it: a row that is out of date (the repeat
    // moved on, or someone changed it) is refused.
    mutationFn: (s: InspectionSchedule) => tasksApi(apiClient).update(s.taskId, { recurrenceRule: null, expectedVersion: s.version, requireNewest: true }),
    onSuccess: (_r, s) => {
      setStopping(null);
      setNotice(`Stopped “${s.title}”. Checks already made stay.`);
      void invalidateTaskQueries(qc);
      void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
    },
    onError: (e) => {
      if (!isStaleSchedule(e)) return;
      setStopping(null);
      setNotice(STALE);
      void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
    },
  });
  const list = q.data?.schedules ?? [];
  const workingDays = q.data?.workingDays ?? [0, 1, 2, 3, 4];
  return (
    <Section
      title="Schedules"
      count={q.data ? list.length : null}
      action={
        canChange ? (
          <Button size="sm" variant="secondary" onClick={() => { setNotice(null); setEditing({ schedule: null }); }} className={coarse}>
            Schedule an inspection
          </Button>
        ) : null
      }
    >
      {notice ? (
        <p role="status" className="mb-2 text-sm text-ink-2">
          {notice}
        </p>
      ) : null}
      {q.isLoading ? <div className="skeleton h-16 rounded-xl" role="status" aria-label="Loading schedules" /> : null}
      {q.isError ? (
        <p role="alert" className="text-sm text-danger">
          {problemText(q.error, 'Couldn’t load the schedules.')}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      {q.data && !list.length ? (
        <p className="text-sm text-ink-2">
          No schedules yet. {canChange ? 'Schedule an inspection to have each check arrive as a task on its day, for its inspectors.' : ''}
        </p>
      ) : null}
      {list.length ? (
        <ul className="flex flex-col gap-2">
          {list.map((s) => (
            <ScheduleRow key={s.taskId} s={s} timeZone={timeZone} canChange={canChange} onEdit={() => { setNotice(null); setEditing({ schedule: s }); }} onStop={() => { stopM.reset(); setStopping(s); }} />
          ))}
        </ul>
      ) : null}
      {editing ? (
        <ScheduleDialog
          projectId={projectId}
          workingDays={workingDays}
          schedule={editing.schedule}
          onClose={() => setEditing(null)}
          onSaved={() => setNotice(editing.schedule ? 'Saved. The checks made from now on follow the new schedule.' : 'Scheduled. The first check is on its way to the inspectors.')}
          onStale={() => setNotice(STALE)}
        />
      ) : null}
      {stopping ? (
        <ConfirmDialog
          title="Stop scheduling?"
          confirmLabel="Stop scheduling"
          keepLabel="Keep it"
          busy={stopM.isPending}
          error={stopM.isError && !isStaleSchedule(stopM.error) ? problemText(stopM.error, 'Couldn’t stop it. Check your connection and try again.') : null}
          onConfirm={() => stopM.mutate(stopping)}
          onClose={() => setStopping(null)}
        >
          No more checks of “<bdi>{stopping.title}</bdi>” will be made. Checks already created stay.
        </ConfirmDialog>
      ) : null}
    </Section>
  );
}
