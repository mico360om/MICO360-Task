import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { notificationSettingsApi, POLICY_KINDS, REMINDER_KINDS, type ApiSchedule, type PolicyKind, type ReminderKind } from '../../api/notification-settings';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import { KIND_WORDS } from '../../lib/notify-kinds';
import { draftOf, readSchedule, scheduleText } from './schedule-words';
import { Panel, SaveRow, inputClass, problemOf, settingsKey, usePolicySave, type TabProps } from './shared';

/**
 * Reminders: which reminders the company sends, which kinds everyone must get (their bell and phone
 * can't be turned off), and the reminder schedules ("reminder templates") projects and tasks pick from.
 */
export function RemindersTab(props: TabProps) {
  return (
    <div className="grid gap-4">
      <KindsPanel {...props} />
      <SchedulesPanel {...props} />
    </div>
  );
}

function KindsPanel({ companyId, data }: TabProps) {
  const { save, pending, saved, problem, touch } = usePolicySave(companyId);
  const [on, setOn] = useState(data.policy.remindersOn);
  const [required, setRequired] = useState<PolicyKind[]>(data.policy.required);
  const key = JSON.stringify([data.policy.remindersOn, data.policy.required]);
  useEffect(() => {
    setOn(data.policy.remindersOn);
    setRequired(data.policy.required);
  }, [key]);

  return (
    <Panel title="Reminders the company sends" id="nst-reminder-kinds">
      <ul className="divide-y divide-line">
        {REMINDER_KINDS.map((k: ReminderKind) => (
          <li key={k} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">{KIND_WORDS[k].label}</div>
              <div className="text-xs text-ink-2">{KIND_WORDS[k].desc}</div>
            </div>
            <Toggle on={on[k]} onChange={() => (touch(), setOn((o) => ({ ...o, [k]: !o[k] })))} label={`Send: ${KIND_WORDS[k].label}`} />
          </li>
        ))}
      </ul>
      <fieldset className="mt-4 border-t border-line pt-4">
        <legend className="mb-1 text-sm font-medium text-ink">Required for everyone</legend>
        <p className="mb-3 text-xs text-ink-2">People can’t turn off the in-app notice or the phone push of these (email stays their choice; quiet hours and Pause still hold the push).</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {POLICY_KINDS.map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[rgb(var(--c-brand))]"
                checked={required.includes(k)}
                onChange={() => (touch(), setRequired((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k])))}
              />
              {KIND_WORDS[k].label}
            </label>
          ))}
        </div>
      </fieldset>
      <SaveRow onSave={() => save({ remindersOn: on, required })} pending={pending} saved={saved} problem={problem} label="Save reminders" />
    </Panel>
  );
}

type Draft = { id: string | null; name: string; before: string; onDue: boolean; after: string; repeat: string };

function SchedulesPanel({ companyId, data }: TabProps) {
  const qc = useQueryClient();
  const api = notificationSettingsApi(apiClient);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: settingsKey(companyId) });
  const begin = () => (setProblem(null), setNote(null));
  const failed = (e: unknown) => setProblem(problemOf(e, 'Couldn’t save the schedule. Please try again.'));

  const saveDraft = useMutation({
    mutationFn: (v: { id: string | null; name: string; steps: ApiSchedule['steps'] }) =>
      v.id ? api.updateSchedule(companyId, v.id, { name: v.name, steps: v.steps }) : api.addSchedule(companyId, { name: v.name, steps: v.steps }),
    onMutate: begin,
    onSuccess: async () => {
      await refresh();
      setDraft(null);
      setNote('Schedule saved.');
    },
    onError: failed,
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api.setDefaultSchedule(companyId, id),
    onMutate: begin,
    onSuccess: async () => {
      await refresh();
      setNote('Default schedule changed.');
    },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeSchedule(companyId, id),
    onMutate: begin,
    onSuccess: async () => {
      await refresh();
      setNote('Schedule removed: projects and tasks that used it follow the default again.');
    },
    onError: failed,
  });

  const submit = () => {
    if (!draft) return;
    if (!draft.name.trim()) return setProblem('Give the schedule a name.');
    const read = readSchedule(draft);
    if (!read.ok) return setProblem(read.problem);
    saveDraft.mutate({ id: draft.id, name: draft.name.trim(), steps: read.steps });
  };

  return (
    <Panel title="Reminder schedules" id="nst-schedules">
      <p className="mb-3 text-sm text-ink-2">
        When a task’s people are reminded, in working days around its due day. Each project uses the default unless it picks another; a task can pick its own. Each
        person’s own “Remind me before due” adds one more.
      </p>
      <ul className="divide-y divide-line">
        {data.schedules.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink">
                <bdi>{s.name}</bdi>
                {s.isDefault ? <span className="ms-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">Default</span> : null}
              </div>
              <div className="text-xs text-ink-2">{scheduleText(s.steps)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => (begin(), setDraft({ id: s.id, name: s.name, ...draftOf(s.steps) }))} aria-label={`Change the ${s.name} schedule`} className="[@media(pointer:coarse)]:!min-h-11">
                Change
              </Button>
              {!s.isDefault ? (
                <Button size="sm" variant="secondary" onClick={() => makeDefault.mutate(s.id)} aria-label={`Make ${s.name} the default`} className="[@media(pointer:coarse)]:!min-h-11">
                  Make default
                </Button>
              ) : null}
              {!s.isDefault && s.builtIn !== 'STANDARD' ? (
                <Button size="sm" variant="secondary" onClick={() => remove.mutate(s.id)} aria-label={`Remove the ${s.name} schedule`} className="[@media(pointer:coarse)]:!min-h-11">
                  Remove
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {draft ? (
        <div className="mt-3 rounded-xl border border-line p-3" role="group" aria-label={draft.id ? 'Change the schedule' : 'New schedule'}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2 sm:col-span-2">
              Name
              <input type="text" maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Working days before the due day
              <input type="text" inputMode="numeric" value={draft.before} onChange={(e) => setDraft({ ...draft, before: e.target.value })} placeholder="e.g. 5, 2, 1" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Working days after it (overdue)
              <input type="text" inputMode="numeric" value={draft.after} onChange={(e) => setDraft({ ...draft, after: e.target.value })} placeholder="e.g. 1" className={inputClass} />
            </label>
            <div className="flex items-center gap-2 text-sm text-ink">
              <Toggle on={draft.onDue} onChange={() => setDraft({ ...draft, onDue: !draft.onDue })} label="On the due morning" />
              <span aria-hidden="true">On the due morning</span>
            </div>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Then every … working days while overdue
              <input type="number" min={1} max={10} value={draft.repeat} onChange={(e) => setDraft({ ...draft, repeat: e.target.value })} placeholder="Leave empty for none" className={inputClass} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={submit} disabled={saveDraft.isPending} className="[@media(pointer:coarse)]:!min-h-11">
              Save schedule
            </Button>
            <Button variant="secondary" onClick={() => setDraft(null)} className="[@media(pointer:coarse)]:!min-h-11">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => (begin(), setDraft({ id: null, name: '', before: '2', onDue: true, after: '1', repeat: '2' }))} className="[@media(pointer:coarse)]:!min-h-11">
            Add a schedule
          </Button>
        </div>
      )}
      {problem ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      {note ? <p role="status" className="mt-3 text-sm text-ink-2">{note}</p> : null}
    </Panel>
  );
}
