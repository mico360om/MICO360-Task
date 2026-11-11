import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITS, RULE_TARGET_KINDS, type RuleInput, type RuleRow, type RuleTargetKind } from '../../../api/training';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { EmptyState } from '../../ui/EmptyState';
import { LoadError } from '../../ui/LoadError';
import { Toggle } from '../../ui/Toggle';
import { fieldClass } from '../../ui/Field';
import { stayOnEnter } from '../../../lib/enter-key';
import { ChoiceGroup, FormRow, ManageDialog } from './ManageDialog';
import { Glyph, Notice, TARGET_KIND_LABELS, count, problemText } from './manage-ui';
import { MANAGE_KEY, REPORTS_KEY, manageKeys, tc, useManageCourses, useManageOptions } from './manage-queries';
import { CourseChecklist, TargetPicker } from './targets';

const ruleDue = (r: Pick<RuleRow, 'dueDays'>) => (r.dueDays ? `Due ${count(r.dueDays, 'day')} after the account is made` : 'No due date');

/**
 * Onboarding rules (owner 7): "every new employee gets Tasks basics and Meetings, due in 14 days". New accounts
 * that match a rule get its courses automatically. Off: no one new gets them (people who did keep them);
 * deleted: unfinished training from it is withdrawn.
 */
export function RulesTab() {
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: manageKeys.rules, queryFn: () => tc().rules() });
  const [editing, setEditing] = useState<RuleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: MANAGE_KEY });
    void qc.invalidateQueries({ queryKey: REPORTS_KEY });
  };
  const toggle = useMutation({
    mutationFn: (r: RuleRow) => tc().updateRule(r.id, { active: !r.active }),
    onMutate: () => setProblem(null),
    onSuccess: refresh,
    onError: (err) => setProblem(`Couldn’t change the rule. ${problemText(err)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => tc().deleteRule(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const rules = listQ.data?.rules ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 max-w-2xl text-sm text-ink-2">
          New accounts get these courses automatically: pick who a rule is for (a group, a department or a company) and its courses. Switched off, no new account gets them; people who already did keep them.
        </p>
        <Button onClick={() => setEditing('new')} className="!min-h-[44px]">
          {Glyph.plus}
          New rule
        </Button>
      </div>
      {problem ? <Notice>{problem}</Notice> : null}
      {listQ.isError ? (
        <LoadError what="the onboarding rules" onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="skeleton h-40 rounded-2xl" role="status" aria-label="Loading onboarding rules" />
      ) : rules.length === 0 ? (
        <EmptyState title="No onboarding rules yet" description="For example: every new employee gets Tasks basics and Meetings, due in 14 days." />
      ) : (
        <ul aria-label="Onboarding rules" className="card divide-y divide-line overflow-hidden">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
              <div className="min-w-0 flex-[1_1_18rem]">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 dir="auto" className="font-semibold text-ink [overflow-wrap:anywhere]">{r.name}</h3>
                  <Badge tone={r.mandatory ? 'brand' : 'neutral'}>{r.mandatory ? 'Mandatory' : 'Optional'}</Badge>
                  {!r.active ? <Badge tone="neutral">Off</Badge> : null}
                </div>
                <p dir="auto" className="mt-0.5 text-sm text-ink">{`${TARGET_KIND_LABELS[r.targetKind]}: ${r.targetLabel}`}</p>
                <p dir="auto" className="mt-0.5 text-sm text-ink-2 [overflow-wrap:anywhere]">{r.courseTitles.join(', ')}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-2">
                  <span>{ruleDue(r)}</span>
                  <span>{`${count(r.people, 'person', 'people')} so far`}</span>
                </p>
              </div>
              <div className="flex flex-none items-center gap-2">
                <Toggle on={toggle.isPending && toggle.variables?.id === r.id ? !r.active : r.active} onChange={() => toggle.mutate(r)} label={`Rule on: ${r.name}`} disabled={toggle.isPending} />
                <Button variant="secondary" size="sm" onClick={() => setEditing(r)} className="[@media(pointer:coarse)]:!min-h-11">Edit</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    remove.reset();
                    setDeleting(r);
                  }}
                  className="[@media(pointer:coarse)]:!min-h-11"
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete the rule “${deleting.name}”?`}
          confirmLabel="Delete rule"
          busy={remove.isPending}
          error={remove.isError ? `Couldn’t delete it. ${problemText(remove.error)}` : null}
          onConfirm={() => remove.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
        >
          New accounts stop getting its courses. Unfinished training from it is withdrawn (unless the person has the course another way). Completed training is kept.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** New or edit an onboarding rule: name, who it is for, courses, mandatory, due days (14 by default) and on/off. */
function RuleDialog({ rule, onClose, onSaved }: { rule: RuleRow | null; onClose: () => void; onSaved: () => void }) {
  const ids = { name: useId(), nameErr: useId(), days: useId(), daysErr: useId(), activeHint: useId() };
  const coursesQ = useManageCourses({ status: 'PUBLISHED' });
  const optionsQ = useManageOptions();
  const [name, setName] = useState(rule?.name ?? '');
  const [targetKind, setTargetKind] = useState<RuleTargetKind>(rule?.targetKind ?? 'GROUP');
  const [targetId, setTargetId] = useState(rule?.targetId ?? '');
  const [courseIds, setCourseIds] = useState<string[]>(rule?.courseIds ?? []);
  const [mandatory, setMandatory] = useState(rule?.mandatory ?? true);
  const [withDue, setWithDue] = useState(rule ? rule.dueDays !== null : true);
  const [days, setDays] = useState(String(rule?.dueDays ?? 14));
  const [active, setActive] = useState(rule?.active ?? true);
  const [errors, setErrors] = useState<{ name?: string; target?: string; courses?: string; days?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = Number(days);
    const problems = {
      name: name.trim() ? (name.trim().length > LIMITS.ruleName ? `Use at most ${LIMITS.ruleName} characters.` : undefined) : 'Give the rule a name.',
      target: targetId ? undefined : 'Choose who it is for.',
      courses: courseIds.length ? undefined : 'Choose at least one course.',
      days: !withDue || (Number.isInteger(n) && n >= 1 && n <= LIMITS.dueDaysMax) ? undefined : `Give a number of days from 1 to ${LIMITS.dueDaysMax}.`,
    };
    setErrors(problems);
    if (Object.values(problems).some(Boolean)) return;
    const input: RuleInput = { name: name.trim(), targetKind, targetId, courseIds, mandatory, dueDays: withDue ? n : null, active };
    setBusy(true);
    setError(null);
    try {
      if (rule) await tc().updateRule(rule.id, input);
      else await tc().createRule(input);
      onSaved();
      onClose();
    } catch (err) {
      setError(`Couldn’t save the rule. ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ManageDialog title={rule ? 'Edit onboarding rule' : 'New onboarding rule'} size="wide" onClose={onClose} onSubmit={() => void save()} submitLabel={rule ? 'Save rule' : 'Create rule'} busy={busy}>
      {error ? <Notice>{error}</Notice> : null}
      <FormRow label="Name" htmlFor={ids.name} error={errors.name} errorId={ids.nameErr} hint="For you: e.g. “Every new employee”.">
        <input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={stayOnEnter}
          maxLength={LIMITS.ruleName}
          dir="auto"
          aria-required="true"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? ids.nameErr : undefined}
          className={fieldClass(!!errors.name, 'w-full')}
        />
      </FormRow>
      <div>
        <TargetPicker kinds={RULE_TARGET_KINDS} kind={targetKind} onKind={setTargetKind} targetId={targetId} onTarget={setTargetId} options={optionsQ.data} name="rule-target" invalid={!!errors.target} />
        {errors.target ? <p className="mt-1 text-xs font-medium text-danger">{errors.target}</p> : null}
      </div>
      <div>
        <CourseChecklist courses={coursesQ.data?.courses ?? []} value={courseIds} onChange={setCourseIds} loading={coursesQ.isLoading} failed={coursesQ.isError} onRetry={() => void coursesQ.refetch()} />
        {errors.courses ? <p className="mt-1 text-xs font-medium text-danger">{errors.courses}</p> : null}
      </div>
      <ChoiceGroup<'yes' | 'no'>
        legend="Mandatory or optional"
        name="rule-mandatory"
        value={mandatory ? 'yes' : 'no'}
        onChange={(v) => setMandatory(v === 'yes')}
        options={[
          { value: 'yes', label: 'Mandatory', hint: 'Reminders, and overdue training is escalated.' },
          { value: 'no', label: 'Optional', hint: 'Reminders only.' },
        ]}
      />
      <div className="flex flex-col gap-2">
        <ChoiceGroup<'days' | 'none'>
          legend="Due"
          name="rule-due"
          value={withDue ? 'days' : 'none'}
          onChange={(v) => setWithDue(v === 'days')}
          options={[
            { value: 'days', label: 'Days after the account is made' },
            { value: 'none', label: 'No due date' },
          ]}
        />
        {withDue ? (
          <FormRow label="Number of days" htmlFor={ids.days} error={errors.days} errorId={ids.daysErr}>
            <input id={ids.days} type="number" inputMode="numeric" min={1} max={LIMITS.dueDaysMax} value={days} onChange={(e) => setDays(e.target.value)} onKeyDown={stayOnEnter} aria-invalid={errors.days ? true : undefined} aria-describedby={errors.days ? ids.daysErr : undefined} className={fieldClass(!!errors.days, 'w-full sm:w-40')} />
          </FormRow>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">On</div>
          <div id={ids.activeHint} className="text-xs text-ink-2">New accounts that match get its courses. Off: no one new gets them.</div>
        </div>
        <Toggle on={active} onChange={() => setActive((v) => !v)} label="Rule on" describedBy={ids.activeHint} />
      </div>
    </ManageDialog>
  );
}
