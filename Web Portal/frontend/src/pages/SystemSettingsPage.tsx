import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { apiClient } from '../api/client';
import { systemSettingsApi } from '../api/system-settings';
import { tasksApi } from '../api/tasks';
import { LoadError } from '../components/ui/LoadError';
import { DailyEmailLog } from '../components/admin/DailyEmailLog';
import { MeetingHoursSettings, workingHoursText } from '../components/admin/MeetingHoursSettings';

const CARRY_STATUSES: { value: string; label: string }[] = [
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'REVIEW', label: 'Review' },
];
const DEFAULT_STATUSES = CARRY_STATUSES.map((s) => s.value);
const STATUS_LABEL = new Map(CARRY_STATUSES.map((s) => [s.value, s.label] as const));
/** Sorts statuses the way the chips are laid out (unknown ones last). */
const byChipOrder = (a: string, b: string) => chipIndex(a) - chipIndex(b);
const chipIndex = (value: string) => { const i = DEFAULT_STATUSES.indexOf(value); return i < 0 ? DEFAULT_STATUSES.length : i; };

/**
 * The settings this page knows how to show, each with a formatter that returns plain text (or null
 * when the stored value isn't the expected shape). Anything else stored in system settings — AI
 * provider config, keys, tokens, internal documents — is never printed here: raw values can hold
 * secrets, and they belong on their own admin pages.
 */
const KNOWN_SETTINGS: { key: string; label: string; format: (v: unknown) => string | null }[] = [
  { key: 'companyName', label: 'Company name', format: (v) => (typeof v === 'string' && v.length <= 200 ? v : null) },
  { key: 'carryForward.enabled', label: 'Automatic carry-forward', format: (v) => (typeof v === 'boolean' ? (v ? 'On' : 'Off') : null) },
  {
    key: 'carryForward.statuses',
    label: 'Statuses that carry forward',
    format: (v) =>
      Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? [...(v as string[])].sort(byChipOrder).map((x) => STATUS_LABEL.get(x) ?? x).join(', ') || 'None'
        : null,
  },
  { key: 'weeklySummary.enabled', label: 'Weekly management summary', format: (v) => (typeof v === 'boolean' ? (v ? 'On' : 'Off') : null) },
  { key: 'company.weekStart', label: 'Company week starts on', format: (v) => WEEK_START_LABEL[v as number] ?? null },
  {
    key: 'meetings.workingHours',
    label: 'Meeting hours',
    format: (v) => {
      const h = v as { days?: unknown; start?: unknown; end?: unknown } | null;
      return h && Array.isArray(h.days) && h.days.length && typeof h.start === 'string' && typeof h.end === 'string'
        ? workingHoursText({ days: h.days as number[], start: h.start, end: h.end })
        : null;
    },
  },
];
/** The company week (the Management page's weeks and the weekly summary's day). */
const WEEK_STARTS: { value: 0 | 1 | 6; label: string }[] = [
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];
const WEEK_START_LABEL: Record<number, string> = { 0: 'Sunday', 1: 'Monday', 6: 'Saturday' };

/** Belt and braces: never show a key that looks secret, even if it were ever added above. */
const SECRET_KEY = /(^ai\.)|secret|token|password|api[-_.]?key|credential|private/i;

/** Known, safe settings as label/value rows; a count of everything else that's hidden. */
export function displayableSettings(settings: { key: string; value: unknown }[]): { rows: { key: string; label: string; value: string }[]; hidden: number } {
  const byKey = new Map(settings.map((s) => [s.key, s.value] as const));
  const rows: { key: string; label: string; value: string }[] = [];
  for (const def of KNOWN_SETTINGS) {
    if (!byKey.has(def.key) || SECRET_KEY.test(def.key)) continue;
    const value = def.format(byKey.get(def.key));
    if (value !== null) rows.push({ key: def.key, label: def.label, value });
  }
  return { rows, hidden: settings.length - rows.length };
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-brand' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export function SystemSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi(apiClient).list() });
  const settings = Array.isArray(q.data) ? q.data : [];
  const shown = displayableSettings(settings);
  const byKey = new Map(settings.map((s) => [s.key, s.value] as const));

  const enabled = byKey.has('carryForward.enabled') ? Boolean(byKey.get('carryForward.enabled')) : true;
  const statuses = Array.isArray(byKey.get('carryForward.statuses')) ? (byKey.get('carryForward.statuses') as string[]) : DEFAULT_STATUSES;
  // The weekly management summary is on, and the company week starts on Sunday, until an administrator changes them.
  const weeklyOn = byKey.get('weeklySummary.enabled') !== false;
  const storedWeekStart = byKey.get('company.weekStart');
  const weekStart = storedWeekStart === 1 || storedWeekStart === 6 ? storedWeekStart : 0;

  const [ranMsg, setRanMsg] = useState<string | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);
  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => systemSettingsApi(apiClient).set(key, value),
    onSuccess: () => {
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ['system-settings'] });
      // The Workload page reads the daily limit and the working hours; the Management page the week start too.
      void qc.invalidateQueries({ queryKey: ['workload'] });
      void qc.invalidateQueries({ queryKey: ['management'] });
    },
    onError: () => setSaveError('Couldn’t save the setting. Please try again.'),
  });
  const runMut = useMutation({
    mutationFn: () => tasksApi(apiClient).runCarryForward(),
    onSuccess: (res) => {
      setRanMsg(`Carried ${res.carried} task${res.carried === 1 ? '' : 's'} forward.`);
      qc.invalidateQueries({ queryKey: ['board'] });
    },
    onError: () => setRanMsg('Couldn’t run carry-forward.'),
  });

  function toggleStatus(value: string) {
    const next = statuses.includes(value) ? statuses.filter((s) => s !== value) : [...statuses, value];
    setMut.mutate({ key: 'carryForward.statuses', value: next });
  }

  return (
    <div>
      <PageHeader eyebrow="Admin" title="System Settings" subtitle="Company-wide configuration." />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Carry-forward */}
        <section className="card p-5">
          <h2 className="eyebrow mb-1">Task carry-forward</h2>
          <p className="mb-4 text-sm text-ink-2">
            At the start of each day, still-open tasks left on past days move onto today’s board. Completed tasks stay on their day.
          </p>
          {saveError ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{saveError}</p> : null}

          <div className="flex items-center justify-between border-t border-line py-3">
            <div>
              <div className="text-sm font-medium text-ink">Automatic carry-forward</div>
              <div className="text-xs text-ink-2">Runs nightly in the company time zone.</div>
            </div>
            <Toggle on={enabled} onChange={() => setMut.mutate({ key: 'carryForward.enabled', value: !enabled })} label="Automatic carry-forward" />
          </div>

          <div className="border-t border-line py-3">
            <div className="mb-2 text-sm font-medium text-ink">Statuses that carry forward</div>
            <div className="flex flex-wrap gap-2">
              {CARRY_STATUSES.map((s) => {
                const on = statuses.includes(s.value);
                return (
                  <label
                    key={s.value}
                    className={`flex cursor-pointer select-none items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))] ${
                      on ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30'
                    } ${enabled ? '' : 'pointer-events-none opacity-50'}`}
                  >
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleStatus(s.value)} disabled={!enabled} />
                    {s.label}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-line pt-3">
            <Button size="sm" variant="secondary" loading={runMut.isPending} disabled={!enabled} onClick={() => runMut.mutate()}>
              Run carry-forward now
            </Button>
            {!enabled ? (
              <span className="text-sm text-ink-2">Switch carry-forward on to run it.</span>
            ) : ranMsg ? (
              <span role="status" className="text-sm text-ink-2">{ranMsg}</span>
            ) : null}
          </div>
        </section>

        {/* Current settings — known, safe values only (never raw JSON). */}
        <section className="card p-5">
          <h2 className="eyebrow mb-3">Current settings</h2>
          {q.isLoading ? (
            <p className="text-ink-2">Loading…</p>
          ) : q.isError ? (
            <LoadError what="the settings" onRetry={() => void q.refetch()} />
          ) : shown.rows.length === 0 ? (
            <p className="text-ink-2">Everything is on its default setting.</p>
          ) : (
            <dl className="divide-y divide-line">
              {shown.rows.map((r) => (
                <div key={r.key} className="flex items-start justify-between gap-4 py-3">
                  <dt className="min-w-0 max-w-[60%] flex-none">
                    <span className="block text-sm text-ink">{r.label}</span>
                    <span className="block font-mono text-[11px] text-ink-3">{r.key}</span>
                  </dt>
                  <dd dir="auto" className="min-w-0 text-end text-sm font-medium text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {!q.isLoading && !q.isError && shown.hidden > 0 ? (
            <p className="mt-3 text-xs text-ink-3">
              {shown.hidden} other setting{shown.hidden === 1 ? ' is' : 's are'} managed on {shown.hidden === 1 ? 'its' : 'their'} own page (for example AI Management) and {shown.hidden === 1 ? 'isn’t' : 'aren’t'} shown here.
            </p>
          ) : null}
        </section>

        {/* The weekly management summary email, and the company week it follows. */}
        <section className="card p-5" aria-labelledby="weekly-summary-admin-heading">
          <h2 id="weekly-summary-admin-heading" className="eyebrow mb-1">Weekly management summary</h2>
          <p className="mb-4 text-sm text-ink-2">
            On the first working morning of each week, everyone who can see the Management page gets a short summary of their projects. Each
            person can also turn theirs off in Settings.
          </p>
          <div className="flex items-center justify-between border-t border-line py-3">
            <div>
              <div className="text-sm font-medium text-ink">Send the weekly summary</div>
              <div className="text-xs text-ink-2">For everyone, at each person’s daily email time.</div>
            </div>
            <Toggle on={weeklyOn} onChange={() => setMut.mutate({ key: 'weeklySummary.enabled', value: !weeklyOn })} label="Weekly management summary" />
          </div>
          <fieldset className="border-t border-line pt-3">
            <legend className="mb-2 text-sm font-medium text-ink">The company week starts on</legend>
            <div className="flex flex-wrap gap-2">
              {WEEK_STARTS.map((w) => (
                <label
                  key={w.value}
                  className={`relative flex cursor-pointer select-none items-center rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))] ${
                    weekStart === w.value ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30'
                  }`}
                >
                  <input type="radio" name="company-week-start" className="sr-only" checked={weekStart === w.value} onChange={() => setMut.mutate({ key: 'company.weekStart', value: w.value })} />
                  {w.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-2">The Management page’s weeks and the weekly summary’s day follow it.</p>
          </fieldset>
        </section>

        {/* The working hours meeting free times are suggested in. */}
        <MeetingHoursSettings />

        {/* The morning task emails: who got which, and how it went. */}
        <DailyEmailLog />
      </div>
    </div>
  );
}
