import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { systemSettingsApi } from '../../api/system-settings';
import { ApiError } from '../../lib/api-client';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import { LoadError } from '../ui/LoadError';
import {
  DEFAULT_MEETING_REMINDERS,
  MAX_REMINDER_TIMES,
  MEETING_REMINDERS_KEY,
  REMINDER_UNITS,
  draftOf,
  isMeetingReminders,
  readDraft,
  type DraftTime,
  type MeetingReminders,
  type ReminderUnit,
} from './meeting-reminder-words';

/** A new row: the first of these not in the list yet. */
const NEW_ROW_CHOICES: DraftTime[] = [
  { amount: '1', unit: 'hours', email: false },
  { amount: '30', unit: 'minutes', email: false },
  { amount: '2', unit: 'hours', email: false },
  { amount: '2', unit: 'days', email: false },
  { amount: '5', unit: 'minutes', email: false },
];

const FIELD = 'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand [@media(pointer:coarse)]:min-h-11';

/**
 * System Settings → Meeting reminders (owner, 31 Oct 2026): the switch for everyone and when the
 * reminders go — by default 24 hours (also by email), 12 hours and 15 minutes before each meeting.
 * The switch saves at once; changed times are saved with Save. Each person can also turn theirs
 * off in Settings → Notifications.
 */
export function MeetingReminderSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi(apiClient).list() });
  const stored = Array.isArray(q.data) ? q.data.find((s) => s.key === MEETING_REMINDERS_KEY)?.value : undefined;
  // Nothing is saved until the stored times are read: a save made from the defaults shown meanwhile
  // would write them over the administrator's own times.
  const ready = q.isSuccess;
  const saved: MeetingReminders = isMeetingReminders(stored) ? stored : DEFAULT_MEETING_REMINDERS;
  const [rows, setRows] = useState<DraftTime[]>(() => draftOf(saved));
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Follow the stored times when they load or change (compared by value: the object is new each render).
  const savedKey = JSON.stringify(saved.times);
  useEffect(() => setRows(draftOf(saved)), [savedKey]);

  const save = useMutation({
    mutationFn: (value: MeetingReminders) => systemSettingsApi(apiClient).set(MEETING_REMINDERS_KEY, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['system-settings'] });
    },
    onError: (e) =>
      setProblem(e instanceof ApiError && e.status === 400 ? 'Those reminder times can’t be saved. Check each time and try again.' : 'Couldn’t save the meeting reminders. Please try again.'),
  });

  const edit = (i: number, patch: Partial<DraftTime>) => {
    setDone(false);
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const add = () => {
    setDone(false);
    setRows((list) => {
      const taken = new Set(list.map((r) => `${r.amount}|${r.unit}`));
      return [...list, NEW_ROW_CHOICES.find((c) => !taken.has(`${c.amount}|${c.unit}`)) ?? NEW_ROW_CHOICES[0]!];
    });
  };
  const remove = (i: number) => {
    setDone(false);
    setRows((list) => list.filter((_, j) => j !== i));
  };
  const toggle = () => {
    setProblem(null);
    setDone(false);
    save.mutate({ enabled: !saved.enabled, times: saved.times });
  };
  const submit = () => {
    setProblem(null);
    setDone(false);
    const read = readDraft(rows);
    if (!read.ok) return setProblem(read.problem);
    save.mutate({ enabled: saved.enabled, times: read.times }, { onSuccess: () => setDone(true) });
  };

  return (
    <section className="card p-5" aria-labelledby="meeting-reminders-heading">
      <h2 id="meeting-reminders-heading" className="eyebrow mb-1">Meeting reminders</h2>
      <p id="meeting-reminders-help" className="mb-4 text-sm text-ink-2">
        Before each scheduled meeting, the organizer and everyone invited who hasn’t declined get a reminder on the website, the Android app and the
        Chrome extension — and an email for the times ticked below. Outside guests get only the emailed ones. Times follow each meeting’s time zone.
        Each person can turn theirs off in Settings.
      </p>
      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      {q.isError ? <LoadError what="the meeting reminders" onRetry={() => void q.refetch()} className="mb-3" /> : null}

      <div className="flex items-center justify-between gap-3 border-t border-line py-3">
        <div>
          <div className="text-sm font-medium text-ink">Send meeting reminders</div>
          <div className="text-xs text-ink-2">For every meeting, to everyone on it.</div>
        </div>
        <Toggle on={saved.enabled} onChange={toggle} label="Meeting reminders" describedBy="meeting-reminders-help" disabled={!ready || save.isPending} />
      </div>

      <fieldset className="border-t border-line pt-3">
        <legend className="mb-2 pt-3 text-sm font-medium text-ink">Reminder times</legend>
        {ready && !saved.enabled ? <p className="mb-2 text-xs text-ink-2">Reminders are off for everyone. These times are kept for when you switch them back on.</p> : null}
        <ul className="mb-3 space-y-2">
          {rows.map((r, i) => {
            const n = i + 1;
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={r.amount}
                  onChange={(e) => edit(i, { amount: e.target.value })}
                  aria-label={`Reminder ${n}: how long before the meeting`}
                  className={`${FIELD} w-20`}
                />
                <select value={r.unit} onChange={(e) => edit(i, { unit: e.target.value as ReminderUnit })} aria-label={`Reminder ${n}: minutes, hours or days`} className={FIELD}>
                  {REMINDER_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-ink-2">before</span>
                <label className="ms-1 flex cursor-pointer items-center gap-2 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
                  <input type="checkbox" checked={r.email} onChange={(e) => edit(i, { email: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--c-brand))]" />
                  <span>
                    <span className="sr-only">{`Reminder ${n}: `}</span>also by email
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={rows.length <= 1}
                  aria-label={`Remove reminder ${n}`}
                  title={rows.length <= 1 ? 'Switch meeting reminders off to send none.' : 'Remove'}
                  className="ms-auto grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={add} disabled={rows.length >= MAX_REMINDER_TIMES}>
            Add a reminder time
          </Button>
          <span className="text-xs text-ink-2">Up to {MAX_REMINDER_TIMES} reminder times.</span>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={!ready || save.isPending} aria-label="Save meeting reminders">
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        {done ? <p role="status" className="text-sm text-ink-2">Saved.</p> : null}
      </div>
    </section>
  );
}
