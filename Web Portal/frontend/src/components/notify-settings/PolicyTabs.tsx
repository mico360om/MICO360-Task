import { useEffect, useMemo, useState } from 'react';
import { POLICY_KINDS, type Channels, type CompanyQuietHours, type NotificationPolicy, type PolicyKind } from '../../api/notification-settings';
import { Toggle } from '../ui/Toggle';
import { MeetingReminderSettings } from '../admin/MeetingReminderSettings';
import { KIND_WORDS, workingDaysText } from '../../lib/notify-kinds';
import { DaysField, Panel, SaveRow, goodDays, inputClass, usePolicySave, type TabProps } from './shared';

/** Keeps a draft of one policy section, following the saved one when it changes. */
function useDraft<K extends keyof NotificationPolicy>(policy: NotificationPolicy, section: K) {
  const [draft, setDraft] = useState<NotificationPolicy[K]>(policy[section]);
  const key = JSON.stringify(policy[section]);
  useEffect(() => setDraft(policy[section]), [key]);
  return [draft, setDraft] as const;
}

/**
 * Escalations: an overdue task goes to whoever runs its project after N working days (then weekly), and
 * to the company's admins or chosen people after M more (once); an approval waiting too long reminds the
 * approver, then goes to the admins. Each project can set its own numbers.
 */
export function EscalationsTab({ companyId, data }: TabProps) {
  const { save, pending, saved, problem, touch } = usePolicySave(companyId);
  const [esc, setEsc] = useDraft(data.policy, 'escalation');
  const [apr, setApr] = useDraft(data.policy, 'approvals');
  const [find, setFind] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const people = useMemo(() => data.people.filter((p) => !p.admin && p.name.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 50), [data.people, find]);
  const chosen = data.people.filter((p) => esc.userIds.includes(p.id));
  const edit = (patch: Partial<typeof esc>) => (touch(), setEsc({ ...esc, ...patch }));

  const submit = () => {
    setLocal(null);
    if (![esc.step1Days, esc.step2Days, apr.step1Days, apr.step2Days].every((n) => goodDays(n))) return setLocal('Each number is whole working days, from 1 to 60.');
    if (!esc.admins && esc.userIds.length === 0) return setLocal('Choose who gets step 2: the admins, or at least one person.');
    save({ escalation: esc, approvals: apr });
  };

  return (
    <Panel title="Escalations" id="nst-escalations">
      <p className="mb-4 text-sm text-ink-2">Counted in working days of the task’s company (weekends and holidays don’t count). Blocked tasks: one notice when blocked, then weekly.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <DaysField label="Step 1: overdue tasks go to the project’s managers after" value={esc.step1Days} onChange={(n) => edit({ step1Days: n })} help="Then once a week while still overdue." />
        <DaysField label="Step 2: still overdue after … more" value={esc.step2Days} onChange={(n) => edit({ step2Days: n })} help="Once, to the people below." />
      </div>
      <fieldset className="mt-4 border-t border-line pt-4">
        <legend className="mb-2 text-sm font-medium text-ink">Step 2 goes to</legend>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">The company’s admins</span>
          <Toggle on={esc.admins} onChange={() => edit({ admins: !esc.admins })} label="Step 2 goes to the company’s admins" />
        </div>
        <div className="mt-3">
          <div className="mb-1 text-sm text-ink">…and these people</div>
          {chosen.length ? (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {chosen.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => edit({ userIds: esc.userIds.filter((u) => u !== p.id) })}
                    aria-label={`Take ${p.name} off step 2`}
                    className="rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand [@media(pointer:coarse)]:!min-h-11"
                  >
                    <bdi>{p.name}</bdi> ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Add a person
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a name" className={inputClass} />
          </label>
          {find.trim() ? (
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line">
              {people.length === 0 ? <li className="px-3 py-2 text-sm text-ink-2">Nobody by that name.</li> : null}
              {people.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={esc.userIds.includes(p.id)}
                    onClick={() => (edit({ userIds: [...esc.userIds, p.id] }), setFind(''))}
                    className="w-full px-3 py-2 text-start text-sm text-ink hover:bg-ground disabled:opacity-50 [@media(pointer:coarse)]:!min-h-11"
                  >
                    <bdi>{p.name}</bdi>
                    {p.email ? <span className="ms-2 text-xs text-ink-3">{p.email}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </fieldset>
      <fieldset className="mt-4 border-t border-line pt-4">
        <legend className="mb-2 text-sm font-medium text-ink">Approvals waiting too long</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <DaysField label="Remind the approver after" value={apr.step1Days} onChange={(n) => (touch(), setApr({ ...apr, step1Days: n }))} />
          <DaysField label="Then to the step 2 people after … more" value={apr.step2Days} onChange={(n) => (touch(), setApr({ ...apr, step2Days: n }))} />
        </div>
      </fieldset>
      <SaveRow onSave={submit} pending={pending} saved={saved} problem={local ?? problem} label="Save escalations" />
    </Panel>
  );
}

/** Inactivity: a started task with no comment, status change, tick or file reminds its people, then whoever runs the project. */
export function InactivityTab({ companyId, data }: TabProps) {
  const { save, pending, saved, problem, touch } = usePolicySave(companyId);
  const [idle, setIdle] = useDraft(data.policy, 'inactivity');
  const [local, setLocal] = useState<string | null>(null);
  const submit = () => {
    setLocal(null);
    if (!goodDays(idle.assigneeDays) || !goodDays(idle.managerDays)) return setLocal('Each number is whole working days, from 1 to 60.');
    if (idle.managerDays < idle.assigneeDays) return setLocal('The manager’s step can’t come before the assignees’.');
    save({ inactivity: idle });
  };
  return (
    <Panel title="Tasks with no activity" id="nst-inactivity">
      <p className="mb-4 text-sm text-ink-2">
        A task In progress or in Review with no comment, status change, checklist tick, file or due-date change — skipped while it waits for its start day, is Blocked or waits for another task.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <DaysField label="Remind its assignees after" value={idle.assigneeDays} onChange={(n) => (touch(), setIdle({ ...idle, assigneeDays: n }))} />
        <DaysField label="…and the project’s managers too after" value={idle.managerDays} onChange={(n) => (touch(), setIdle({ ...idle, managerDays: n }))} />
      </div>
      <SaveRow onSave={submit} pending={pending} saved={saved} problem={local ?? problem} label="Save inactivity" />
    </Panel>
  );
}

/** Quiet hours: outside working hours (and on days off) unless the company sets nightly hours; what comes through them. */
export function QuietHoursTab({ companyId, data }: TabProps) {
  const { save, pending, saved, problem, touch } = usePolicySave(companyId);
  const [q, setQ] = useDraft(data.policy, 'quietHours');
  const edit = (patch: Partial<CompanyQuietHours>) => (touch(), setQ({ ...q, ...patch }));
  const hours = data.workingTime.workingHours;
  return (
    <Panel title="Quiet hours" id="nst-quiet">
      <p className="mb-4 text-sm text-ink-2">
        In quiet hours the bell still fills; phone pushes and emails wait for the next working morning and then go as one message. Days off are always quiet. Each person can set their own.
      </p>
      <fieldset>
        <legend className="sr-only">When it is quiet</legend>
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
            <input type="radio" name="nst-quiet" className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-brand))]" checked={q.mode === 'workingHours'} onChange={() => edit({ mode: 'workingHours' })} />
            <span>
              Outside working hours ({workingDaysText(hours.days)}, {hours.start}–{hours.end})
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
            <input type="radio" name="nst-quiet" className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-brand))]" checked={q.mode === 'custom'} onChange={() => edit({ mode: 'custom' })} />
            <span>Every night between two times</span>
          </label>
        </div>
      </fieldset>
      {q.mode === 'custom' ? (
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Quiet from
            <input type="time" value={q.start} onChange={(e) => edit({ start: e.target.value })} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Until
            <input type="time" value={q.end} onChange={(e) => edit({ end: e.target.value })} className={inputClass} />
          </label>
        </div>
      ) : null}
      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">Meeting reminders come through quiet hours</span>
          <Toggle on={q.meetings} onChange={() => edit({ meetings: !q.meetings })} label="Meeting reminders come through quiet hours" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">@mentions and direct messages come through quiet hours</span>
          <Toggle on={q.mentions} onChange={() => edit({ mentions: !q.mentions })} label="@mentions and direct messages come through quiet hours" />
        </div>
      </div>
      <SaveRow onSave={() => save({ quietHours: q })} pending={pending} saved={saved} problem={problem} label="Save quiet hours" />
    </Panel>
  );
}

const CHANNEL_COLUMNS: { key: keyof Channels; head: string; word: string }[] = [
  { key: 'bell', head: 'In the app', word: 'in the app' },
  { key: 'push', head: 'Phone', word: 'phone push' },
  { key: 'email', head: 'Email', word: 'email' },
];

/** Channels: each kind's defaults on the bell, the phone and email (people change their own), and the meeting reminder times. */
export function ChannelsTab({ companyId, data }: TabProps) {
  const { save, pending, saved, problem, touch } = usePolicySave(companyId);
  const [chans, setChans] = useDraft(data.policy, 'channels');
  const flip = (k: PolicyKind, c: keyof Channels) => {
    touch();
    const next = { ...chans[k], [c]: !chans[k][c] };
    if (c === 'bell' && !next.bell) next.push = false;
    setChans({ ...chans, [k]: next });
  };
  return (
    <div className="grid gap-4">
      <Panel title="Channels" id="nst-channels">
        <p className="mb-3 text-sm text-ink-2">
          What everyone gets until they change it in their own Settings. A phone push is the in-app notice on the phone, so it needs it. Email for task notices is new: the daily
          email already covers them.
        </p>
        <div role="table" aria-label="Defaults for each kind of notice" className="text-sm">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.25rem)] items-end gap-x-2 border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,5rem)]">
            <span role="columnheader">Notice</span>
            {CHANNEL_COLUMNS.map((c) => (
              <span role="columnheader" key={c.key} className="text-center">
                {c.head}
              </span>
            ))}
          </div>
          {POLICY_KINDS.map((k) => (
            <div role="row" key={k} className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.25rem)] items-center gap-x-2 border-b border-line py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_repeat(3,5rem)]">
              <div role="cell" className="min-w-0 font-medium text-ink">
                {KIND_WORDS[k].label}
                {data.policy.required.includes(k) ? <span className="block text-xs font-semibold text-brand">Required</span> : null}
              </div>
              {CHANNEL_COLUMNS.map((c) =>
                c.key === 'email' && k === 'meetings' ? (
                  <div role="cell" key={c.key} className="text-center text-[11px] text-ink-3" title="Set by each reminder time’s “also by email” below">
                    —
                  </div>
                ) : (
                  <div role="cell" key={c.key} className="flex justify-center">
                    <Toggle on={chans[k][c.key]} onChange={() => flip(k, c.key)} label={`${KIND_WORDS[k].label}: ${c.word} by default`} disabled={c.key === 'push' && !chans[k].bell} />
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
        <SaveRow onSave={() => save({ channels: chans })} pending={pending} saved={saved} problem={problem} label="Save channels" />
      </Panel>
      <p className="text-xs text-ink-2">The meeting reminder times below are the same for every company on the site.</p>
      <MeetingReminderSettings />
    </div>
  );
}
