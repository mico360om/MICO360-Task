import { useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { inspectionsApi, type InspectionSchedule } from '../../api/inspections';
import { membersApi } from '../../api/members';
import { usersApi } from '../../api/users';
import { columnsApi } from '../../api/columns';
import { assigneesApi } from '../../api/assignees';
import { tasksApi, type NewTaskInput, type RecurrenceRule } from '../../api/tasks';
import { useDialog } from '../../hooks/useDialog';
import { useCompanyTimeZone } from '../../lib/company-clock';
import { todayKey } from '../../lib/due-date';
import { INSPECTION_LIMITS } from '../../lib/inspection-rules';
import { newIdempotencyKey } from '../../lib/offline-queue';
import { invalidateTaskQueries } from '../../lib/task-cache';
import { defaultScheduleName, firstCheckDay, presetOf, presetRule, SCHEDULE_PRESETS, scheduleSentence, type SchedulePreset } from '../../lib/inspection-schedule';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { SearchableSelect } from '../ui/SearchableSelect';
import { RecurrenceEditor } from '../RecurrenceEditor';
import { AssigneeSelect, type PersonOption } from '../task-form/AssigneeSelect';
import { problemText } from './inspection-ui';
import { ApiError } from '../../lib/api-client';

/** The schedule changed since the list was read (the repeat moved on to a newer copy, or an edit). */
export const isStaleSchedule = (e: unknown) => e instanceof ApiError && e.status === 409 && (e.code === 'VERSION_CONFLICT' || e.code === 'RECURRENCE_NOT_NEWEST');

const TITLE_MAX = 191;
const fullName = (u: { firstName?: string | null; lastName?: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
const onSchedule = (rule: RecurrenceRule): RecurrenceRule => ({ ...rule, createNext: 'ON_SCHEDULE' });
const field = 'block h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 sm:h-10 sm:text-sm';
const label = 'mb-1 block text-sm font-semibold text-ink';

/**
 * Schedule an inspection (or change a schedule): which form, what the checks are called, where,
 * who does them, from when and how often. Every check is a task due on its day, assigned to the
 * inspectors, made on schedule whether or not the one before was done. Saved through the task API:
 * the schedule is the series' newest copy, which carries the repeat.
 */
export function ScheduleDialog({
  projectId,
  workingDays,
  schedule,
  onClose,
  onSaved,
  onStale,
}: {
  projectId: string;
  /** The company's working days (0 = Sunday), for "Every working day". */
  workingDays: number[];
  /** Edit this schedule; without it, a new one. */
  schedule?: InspectionSchedule | null;
  onClose: () => void;
  onSaved?: () => void;
  /** Saving found the schedule changed meanwhile: nothing was saved (the list is read again). */
  onStale?: () => void;
}) {
  const editing = !!schedule;
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const today = todayKey(timeZone);
  const ids = { title: useId(), name: useId(), place: useId(), starts: useId(), presets: useId(), sentence: useId(), inspectors: useId() };

  const formsQ = useQuery({ queryKey: ['inspection-forms'], queryFn: () => inspectionsApi(apiClient).listForms() });
  const membersQ = useQuery({ queryKey: ['members', projectId], queryFn: () => membersApi(apiClient).list(projectId) });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const forms = useMemo(() => formsQ.data?.forms ?? [], [formsQ.data]);
  const people = useMemo<PersonOption[]>(() => {
    const dir = Array.isArray(dirQ.data) ? dirQ.data : [];
    return (Array.isArray(membersQ.data) ? membersQ.data : []).map((m) => ({ id: m.id, name: fullName(m), username: m.username, avatarUrl: dir.find((d) => d.id === m.id)?.avatarUrl ?? null }));
  }, [membersQ.data, dirQ.data]);
  const known = useRef(new Map<string, string>((schedule?.assignees ?? []).map((a) => [a.id, a.name])));
  for (const p of people) known.current.set(p.id, p.name);

  const [formId, setFormId] = useState(schedule?.form.id ?? '');
  const [place, setPlace] = useState(schedule?.place ?? '');
  const formTitle = forms.find((f) => f.id === formId)?.title ?? (schedule && schedule.form.id === formId ? schedule.form.title : '');
  // The name follows the form and place until the person types their own.
  const [typedName, setTypedName] = useState<string | null>(schedule && schedule.title !== defaultScheduleName(schedule.form.title, schedule.place ?? '') ? schedule.title : null);
  const name = typedName ?? defaultScheduleName(formTitle, place);
  const [inspectorIds, setInspectorIds] = useState<string[]>(schedule?.assignees.map((a) => a.id) ?? []);
  const [startsOn, setStartsOn] = useState(today);
  const [preset, setPreset] = useState<SchedulePreset>(schedule ? presetOf(schedule.rule, workingDays) : 'WORKING_DAYS');
  const [rule, setRule] = useState<RecurrenceRule>(schedule ? onSchedule(schedule.rule) : presetRule('WORKING_DAYS', today, workingDays));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  // One key for the dialog's life: a retry after a lost reply gets the schedule already made (the
  // server answers it again), never a second one. Changed only once the server refused a try (a 4xx:
  // nothing was made — and the server would otherwise answer that refusal again).
  const idempotencyKey = useRef(newIdempotencyKey());
  const dialogRef = useDialog(saving ? () => {} : onClose);

  /** How the series ends is kept when the person picks another preset. */
  const withEnds = (next: RecurrenceRule): RecurrenceRule => ({ ...next, ...(rule.count != null ? { count: rule.count } : {}), ...(rule.until ? { until: rule.until } : {}) });
  function choosePreset(p: SchedulePreset) {
    setPreset(p);
    if (p !== 'CUSTOM') setRule(withEnds(presetRule(p, startsOn, workingDays)));
  }
  function chooseStart(day: string) {
    setStartsOn(day);
    // "Weekly on…" and "Monthly" follow the start day's weekday and date until changed by hand.
    if (day && (preset === 'WEEKLY' || preset === 'MONTHLY')) setRule(withEnds(presetRule(preset, day, workingDays)));
  }

  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(startsOn);
  const firstDay = editing || !validStart ? null : firstCheckDay(startsOn, rule);
  const inspectorNames = inspectorIds.map((id) => known.current.get(id) ?? 'Someone');
  const sentence = scheduleSentence(rule, inspectorNames, workingDays, firstDay);

  async function save() {
    if (busy.current) return;
    const title = name.trim();
    const problemNow = !formId
      ? 'Pick a form.'
      : !inspectorIds.length
        ? 'Pick at least one inspector.'
        : !title
          ? 'Give the schedule a name.'
          : !editing && (!validStart || startsOn < today)
            ? 'Pick today or a later day to start.'
            : rule.until && firstDay && rule.until.slice(0, 10) < firstDay
              ? 'The repeat can’t end before the first check.'
              : null;
    setProblem(problemNow);
    if (problemNow) return;
    busy.current = true;
    setSaving(true);
    try {
      const recurrenceRule = onSchedule(rule);
      if (!schedule) {
        const columns = await qc.fetchQuery({ queryKey: ['columns', projectId], queryFn: () => columnsApi(apiClient).list(projectId) });
        const sorted = [...(Array.isArray(columns) ? columns : [])].sort((a, b) => a.position - b.position);
        const column = sorted.find((c) => c.enabled !== false && c.category !== 'DONE') ?? sorted.find((c) => c.enabled !== false);
        if (!column) throw new Error('This project has no columns to put the checks in.');
        const input: NewTaskInput & { recurrenceRule: RecurrenceRule } = {
          title,
          projectId,
          columnId: column.id,
          dueDate: firstDay!,
          recurrenceRule,
          assigneeIds: inspectorIds,
          inspectionFormId: formId,
          inspectionPlace: place.trim() || null,
        };
        await tasksApi(apiClient).create(input, { idempotencyKey: idempotencyKey.current });
      } else {
        const patch: Parameters<ReturnType<typeof tasksApi>['update']>[1] = {};
        if (title !== schedule.title) patch.title = title;
        if (formId !== schedule.form.id) patch.inspectionFormId = formId;
        if ((place.trim() || null) !== (schedule.place ?? null)) patch.inspectionPlace = place.trim() || null;
        // Compared with the rule as stored: one that waits for each check is put on schedule by saving.
        if (JSON.stringify(recurrenceRule) !== JSON.stringify(schedule.rule)) patch.recurrenceRule = recurrenceRule;
        // Always sent, with the version the list showed: on a schedule that changed meanwhile (the repeat
        // moved on to a newer copy) nothing is saved — not even the inspectors below.
        await tasksApi(apiClient).update(schedule.taskId, { ...patch, expectedVersion: schedule.version });
        const before = schedule.assignees.map((a) => a.id);
        const add = inspectorIds.filter((id) => !before.includes(id));
        if (add.length) await assigneesApi(apiClient).assignMany(schedule.taskId, add);
        for (const id of before.filter((x) => !inspectorIds.includes(x))) await assigneesApi(apiClient).unassign(schedule.taskId, id);
      }
      void invalidateTaskQueries(qc);
      void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
      onSaved?.();
      onClose();
    } catch (e) {
      if (!editing && e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 409) idempotencyKey.current = newIdempotencyKey();
      if (editing && isStaleSchedule(e) && onStale) {
        void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
        onStale();
        onClose();
        return;
      }
      setProblem(problemText(e, editing ? 'Couldn’t save the changes. Check your connection and try again.' : 'Couldn’t schedule it. Check your connection and try again.'));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const heading = editing ? 'Edit schedule' : 'Schedule an inspection';
  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-3 sm:p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={saving ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={ids.title} className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height,100vh)-1.5rem)] w-full max-w-xl animate-scale-in flex-col overflow-hidden">
          <div className="border-b border-line px-4 pb-3 pt-4 sm:px-5">
            <h2 id={ids.title} className="font-display text-lg font-semibold text-ink">
              {heading}
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              {editing ? 'Changes apply to the checks made from now on. Checks already made stay as they are.' : 'Each check arrives as a task on its day, for the inspectors. A missed one stays open as late, and can still be done.'}
            </p>
          </div>
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
              <div>
                <span className={label}>
                  Form <span aria-hidden="true" className="text-danger">*</span>
                </span>
                <SearchableSelect
                  size="lg"
                  ariaLabel="Form"
                  placeholder={formsQ.isLoading ? 'Loading forms…' : forms.length ? 'Choose a form' : 'No inspection forms yet'}
                  emptyText="No form matches."
                  options={forms.map((f) => ({ value: f.id, label: f.title, hint: `${f.itemCount} ${f.itemCount === 1 ? 'item' : 'items'}` }))}
                  value={formId}
                  onChange={(v) => {
                    setFormId(v);
                    setProblem(null);
                  }}
                  disabled={saving}
                />
                {formsQ.isError ? <p className="mt-1 text-xs text-danger">{problemText(formsQ.error, 'Couldn’t load the forms.')}</p> : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor={ids.place} className={label}>
                    Place (optional)
                  </label>
                  <input id={ids.place} dir="auto" value={place} maxLength={INSPECTION_LIMITS.placeMax} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Rig 3" className={field} disabled={saving} />
                </div>
                <div className="min-w-0">
                  <label htmlFor={ids.name} className={label}>
                    Name
                  </label>
                  <input
                    id={ids.name}
                    dir="auto"
                    value={name}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder="Picked from the form and place"
                    className={field}
                    disabled={saving}
                  />
                </div>
              </div>

              <div>
                <span id={ids.inspectors} className={label}>
                  Inspectors <span aria-hidden="true" className="text-danger">*</span>
                </span>
                <AssigneeSelect
                  people={people}
                  value={inspectorIds}
                  onChange={(next) => {
                    setInspectorIds(next);
                    setProblem(null);
                  }}
                  listLabel="Inspectors"
                  addLabel="Add inspectors"
                  allChosenText="Everyone on this project is an inspector."
                  note="The same people get every check. They can change it on the schedule later."
                  disabled={saving}
                />
              </div>

              {!editing ? (
                <div className="sm:w-1/2 sm:pe-2">
                  <label htmlFor={ids.starts} className={label}>
                    Starts on
                  </label>
                  <input id={ids.starts} type="date" min={today} value={startsOn} onChange={(e) => chooseStart(e.target.value)} className={field} disabled={saving} />
                </div>
              ) : null}

              <fieldset className="min-w-0">
                <legend id={ids.presets} className={label}>
                  Repeat
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {SCHEDULE_PRESETS.map((p) => (
                    <label
                      key={p.value}
                      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-brand/40 sm:min-h-9 ${preset === p.value ? 'border-brand bg-brand/10 text-brand' : 'border-line text-ink hover:bg-ground'}`}
                    >
                      <input type="radio" name="schedule-preset" value={p.value} checked={preset === p.value} onChange={() => choosePreset(p.value)} className="accent-[rgb(var(--c-brand))]" disabled={saving} />
                      {p.label}
                    </label>
                  ))}
                </div>
                <div className="mt-3 rounded-xl border border-line bg-ground/50 p-3">
                  <RecurrenceEditor
                    kind="check"
                    value={rule}
                    onChange={(next) => {
                      if (next) setRule(onSchedule(next));
                    }}
                    dueDate={firstDay ?? schedule?.nextDue ?? null}
                    hideFrequency={preset !== 'CUSTOM'}
                    only={preset === 'DAILY' || preset === 'WORKING_DAYS' ? 'ends' : undefined}
                  />
                </div>
                <p id={ids.sentence} aria-live="polite" className="mt-2 flex items-start gap-2 text-sm text-ink">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none text-brand">
                    <path d="M17 2l4 4-4 4" />
                    <path d="M3 11V9a3 3 0 0 1 3-3h15" />
                    <path d="M7 22l-4-4 4-4" />
                    <path d="M21 13v2a3 3 0 0 1-3 3H3" />
                  </svg>
                  <span>{sentence}</span>
                </p>
              </fieldset>

              {problem ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {problem}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-5">
              <Button type="button" variant="secondary" onClick={onClose} disabled={saving} className="min-h-11 sm:min-h-0">
                Cancel
              </Button>
              <Button type="submit" loading={saving} className="min-h-11 sm:min-h-0">
                {editing ? 'Save changes' : 'Schedule it'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
