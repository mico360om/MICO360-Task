import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITS, RULE_TARGET_KINDS, TARGET_KINDS, type AssignmentInput, type TargetKind } from '../../../api/training';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { fieldClass } from '../../ui/Field';
import { stayOnEnter } from '../../../lib/enter-key';
import { ChoiceGroup, FormRow, ManageDialog } from './ManageDialog';
import { Notice, count, problemText, todayKey } from './manage-ui';
import { MANAGE_KEY, REPORTS_KEY, tc, useManageCourses, useManageOptions } from './manage-queries';
import { CourseChecklist, TargetPicker } from './targets';

type DueMode = 'none' | 'day' | 'days';

/** The due fields as the API takes them (none, a fixed day, or N days after each person gets it). */
export function dueOf(mode: DueMode, day: string, days: string): { dueDay: string | null; dueDays: number | null } {
  if (mode === 'day') return { dueDay: day || null, dueDays: null };
  if (mode === 'days') {
    const n = Number(days);
    return { dueDay: null, dueDays: Number.isInteger(n) ? n : null };
  }
  return { dueDay: null, dueDays: null };
}

/** Why the due fields can't be used yet, or null. */
export function dueProblem(mode: DueMode, day: string, days: string): string | null {
  if (mode === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Choose the due day.';
    if (day < todayKey()) return 'Choose a due day from today on.';
  }
  if (mode === 'days') {
    const n = Number(days);
    if (!days.trim() || !Number.isInteger(n) || n < 1 || n > LIMITS.dueDaysMax) return `Give a number of days from 1 to ${LIMITS.dueDaysMax}.`;
  }
  return null;
}

/** "New staff only" is for a group, a department or a company (owner answer 2: an onboarding rule underneath). */
export const newStaffKind = (kind: TargetKind): boolean => (RULE_TARGET_KINDS as readonly string[]).includes(kind);

/**
 * "Assign a course": one or more published courses, who it is for (a person, a group, a department, a company
 * or a project's team), mandatory or optional, and when it is due. A group, department or company can be for
 * "Only people who join from now on (new staff only)" (12 Nov; due a number of days after they join, or never).
 * A live preview says how many people it reaches, how many have it already and who can't see a course (they are
 * skipped) before anything is saved.
 */
export function AssignDialog({ onClose, onAssigned, initialCourseIds = [] }: { onClose: () => void; onAssigned: (reach: number | null, newStaff: boolean) => void; initialCourseIds?: string[] }) {
  const qc = useQueryClient();
  const ids = { day: useId(), days: useId(), dueErr: useId() };
  const coursesQ = useManageCourses({ status: 'PUBLISHED' });
  const optionsQ = useManageOptions();
  const [courseIds, setCourseIds] = useState<string[]>(initialCourseIds);
  const [targetKind, setTargetKind] = useState<TargetKind>('GROUP');
  const [targetId, setTargetId] = useState('');
  const [mandatory, setMandatory] = useState(true);
  const [dueMode, setDueMode] = useState<DueMode>('none');
  const [whoMode, setWhoMode] = useState<'all' | 'new'>('all');
  const [dueDay, setDueDay] = useState('');
  const [dueDays, setDueDays] = useState('14');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const newStaff = whoMode === 'new' && newStaffKind(targetKind);
  // New staff get it when they join: no fixed day (a day chosen before switching falls back to none).
  const dueChoice: DueMode = newStaff && dueMode === 'day' ? 'none' : dueMode;
  const due = dueOf(dueChoice, dueDay, dueDays);
  const problem = dueProblem(dueChoice, dueDay, dueDays);
  const input: AssignmentInput = { courseIds, targetKind, targetId, mandatory, ...due, ...(newStaff ? { newStaffOnly: true } : {}) };
  const ready = courseIds.length > 0 && !!targetId && !problem;
  const key = JSON.stringify(input);
  const settledKey = useDebouncedValue(key, 300);
  const previewQ = useQuery({
    queryKey: [...MANAGE_KEY, 'preview', settledKey],
    queryFn: () => tc().previewAssignment(JSON.parse(settledKey) as AssignmentInput),
    enabled: ready && settledKey === key,
    staleTime: 0,
    gcTime: 0,
  });
  const preview = ready && settledKey === key ? previewQ.data : undefined;

  async function assign() {
    if (!ready || !preview) return;
    setBusy(true);
    setError(null);
    try {
      await tc().assign(input);
      void qc.invalidateQueries({ queryKey: MANAGE_KEY });
      void qc.invalidateQueries({ queryKey: REPORTS_KEY });
      onAssigned(preview.reach, newStaff);
      onClose();
    } catch (err) {
      setError(`Couldn’t assign it. ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ManageDialog title="Assign a course" size="wide" onClose={onClose} onSubmit={() => void assign()} submitLabel="Assign" busy={busy} submitDisabled={!ready || !preview}>
      {error ? <Notice>{error}</Notice> : null}
      <CourseChecklist
        courses={coursesQ.data?.courses ?? []}
        value={courseIds}
        onChange={setCourseIds}
        loading={coursesQ.isLoading}
        failed={coursesQ.isError}
        onRetry={() => void coursesQ.refetch()}
      />
      {optionsQ.isError ? <Notice>{`Couldn’t load who you can assign to. ${problemText(optionsQ.error)}`}</Notice> : null}
      <TargetPicker
        kinds={TARGET_KINDS}
        kind={targetKind}
        onKind={(k) => {
          setTargetKind(k);
          // A person or a project's team: everyone in it, always.
          if (!newStaffKind(k)) setWhoMode('all');
        }}
        targetId={targetId}
        onTarget={setTargetId}
        options={optionsQ.data}
        name="assign-target"
      />
      {newStaffKind(targetKind) ? (
        <ChoiceGroup<'all' | 'new'>
          legend="Who gets it"
          name="assign-who"
          value={whoMode}
          onChange={setWhoMode}
          options={[
            { value: 'all', label: 'Everyone in it, now and when people join' },
            { value: 'new', label: 'Only people who join from now on (new staff only)', hint: 'Nobody there today gets it.' },
          ]}
        />
      ) : null}
      <ChoiceGroup<'yes' | 'no'>
        legend="Mandatory or optional"
        name="assign-mandatory"
        value={mandatory ? 'yes' : 'no'}
        onChange={(v) => setMandatory(v === 'yes')}
        options={[
          { value: 'yes', label: 'Mandatory', hint: 'Reminders, and an overdue course is escalated.' },
          { value: 'no', label: 'Optional', hint: 'Reminders only.' },
        ]}
      />
      <div className="flex flex-col gap-2">
        <ChoiceGroup<DueMode>
          legend="Due"
          name="assign-due"
          value={dueChoice}
          onChange={setDueMode}
          options={
            newStaff
              ? [
                  { value: 'none', label: 'No due date' },
                  { value: 'days', label: 'Days after they join' },
                ]
              : [
                  { value: 'none', label: 'No due date' },
                  { value: 'day', label: 'A day' },
                  { value: 'days', label: 'Days after it is assigned' },
                ]
          }
        />
        {dueChoice === 'day' ? (
          <FormRow label="Due day" htmlFor={ids.day} error={problem} errorId={ids.dueErr}>
            <input id={ids.day} type="date" value={dueDay} min={todayKey()} onChange={(e) => setDueDay(e.target.value)} onKeyDown={stayOnEnter} aria-invalid={problem ? true : undefined} aria-describedby={problem ? ids.dueErr : undefined} className={fieldClass(!!problem && !!dueDay, 'w-full sm:w-56')} />
          </FormRow>
        ) : dueChoice === 'days' ? (
          <FormRow label="Number of days" htmlFor={ids.days} error={problem} errorId={ids.dueErr} hint={newStaff ? 'Each person’s own due day: this many days after they join.' : 'Each person’s own due day: this many days after they get it (people who join a group later too).'}>
            <input id={ids.days} type="number" inputMode="numeric" min={1} max={LIMITS.dueDaysMax} value={dueDays} onChange={(e) => setDueDays(e.target.value)} onKeyDown={stayOnEnter} aria-invalid={problem ? true : undefined} aria-describedby={problem ? ids.dueErr : undefined} className={fieldClass(!!problem, 'w-full sm:w-40')} />
          </FormRow>
        ) : null}
      </div>
      <PreviewBox ready={ready} loading={ready && (settledKey !== key || previewQ.isFetching)} error={previewQ.isError ? problemText(previewQ.error) : null} preview={preview} group={targetKind !== 'USER'} newStaff={newStaff} />
    </ManageDialog>
  );
}

function PreviewBox({ ready, loading, error, preview, group, newStaff }: { ready: boolean; loading: boolean; error: string | null; preview: { reach: number; already: number; skipped: { name: string; reason: string }[] } | undefined; group: boolean; newStaff: boolean }) {
  return (
    <div role="status" aria-label="Preview" aria-live="polite" className="rounded-xl border border-line bg-ground px-4 py-3 text-sm">
      {!ready ? (
        <p className="text-ink-2">Choose the courses and who it is for to see who it reaches.</p>
      ) : error ? (
        <p className="text-danger">{error}</p>
      ) : loading || !preview ? (
        <p className="text-ink-2">Checking who it reaches…</p>
      ) : newStaff ? (
        <p className="font-semibold text-ink">Nobody yet. People who join from now on get it.</p>
      ) : (
        <>
          <p className="font-semibold text-ink">{`Reaches ${count(preview.reach, 'person', 'people')} · ${preview.already.toLocaleString('en-US')} already have it · ${preview.skipped.length.toLocaleString('en-US')} can’t see it`}</p>
          {preview.reach === 0 && group ? <p className="mt-1 text-ink-2">Nobody yet. People who join later get it automatically.</p> : null}
          {preview.skipped.length ? (
            <div className="mt-2">
              <p className="text-xs font-semibold text-ink-2">Skipped (the course isn’t meant for them):</p>
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-ink-2">
                {preview.skipped.map((s, i) => (
                  <li key={`${s.name}-${i}`} dir="auto">{`${s.name} — ${s.reason}`}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
