import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { notificationSettingsApi, type CompanyNotificationSettings, type WorkingTimeView } from '../../api/notification-settings';
import { Button } from '../ui/Button';
import { Panel, SaveRow, inputClass, problemOf, settingsKey, type TabProps } from './shared';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_STARTS: { value: 0 | 1 | 6; label: string }[] = [
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

/**
 * Working time: the company's working days and hours (they were System Settings → Meeting hours), its week
 * start, and the site's time zone (one for the whole site). Reminders, quiet hours, the daily email and
 * every "N working days" count follow them.
 */
export function WorkingTimeTab({ companyId, data, companyCount }: TabProps) {
  const qc = useQueryClient();
  const wt = data.workingTime;
  const [draft, setDraft] = useState({ weekStart: wt.weekStart, days: wt.workingHours.days, start: wt.workingHours.start, end: wt.workingHours.end });
  const key = `${wt.weekStart}|${wt.workingHours.days.join(',')}|${wt.workingHours.start}|${wt.workingHours.end}`;
  useEffect(() => setDraft({ weekStart: wt.weekStart, days: wt.workingHours.days, start: wt.workingHours.start, end: wt.workingHours.end }), [key]);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const done = (view: WorkingTimeView) => {
    qc.setQueryData<CompanyNotificationSettings>(settingsKey(companyId), (d) => (d ? { ...d, workingTime: view } : d));
    // Everything that reads working days or hours: workload, management, free times, the company list.
    for (const k of [['workload'], ['management'], ['system-settings'], ['companies'], ['me', 'companies'], ['working-time']]) void qc.invalidateQueries({ queryKey: k });
    setSaved(true);
  };
  const save = useMutation({
    mutationFn: () => notificationSettingsApi(apiClient).saveWorkingTime(companyId, { weekStart: draft.weekStart, workingHours: { days: draft.days, start: draft.start, end: draft.end } }),
    onSuccess: done,
    onError: (e) => setProblem(problemOf(e, 'Couldn’t save the working time. Please try again.')),
  });
  const follow = useMutation({
    mutationFn: () => notificationSettingsApi(apiClient).followSite(companyId),
    onSuccess: done,
    onError: (e) => setProblem(problemOf(e, 'Couldn’t change that. Please try again.')),
  });

  const submit = () => {
    setSaved(false);
    setProblem(null);
    if (draft.days.length === 0) return setProblem('Choose at least one working day.');
    if (!/^\d{2}:\d{2}$/.test(draft.start) || !/^\d{2}:\d{2}$/.test(draft.end)) return setProblem('Choose a start and an end time.');
    if (draft.end <= draft.start) return setProblem('The day has to end after it starts.');
    save.mutate();
  };
  const toggle = (day: number) => {
    setSaved(false);
    setDraft((d) => ({ ...d, days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day].sort((a, b) => a - b) }));
  };

  return (
    <Panel title="Working time" id="nst-working-time">
      <p className="mb-4 text-sm text-ink-2">
        Reminders and escalations count these working days; quiet hours are outside these hours (unless set otherwise); meeting free times stay inside them.
      </p>
      <p className="mb-4 text-sm text-ink">
        <span className="font-medium">Time zone:</span> {data.timeZone} — the site’s time zone. Each person’s own time zone still sets when their emails arrive.
      </p>
      {companyCount > 1 && !wt.own ? <p className="mb-3 text-xs text-ink-2">This company follows the site’s working time; saving here gives it its own.</p> : null}
      <div role="group" aria-label="Working days" className="mb-4 flex flex-wrap gap-1.5">
        {DAYS.map((name, day) => (
          <button
            key={name}
            type="button"
            aria-pressed={draft.days.includes(day)}
            onClick={() => toggle(day)}
            className={`min-h-9 min-w-[3rem] rounded-lg border px-2.5 text-sm font-semibold transition-colors [@media(pointer:coarse)]:!min-h-11 ${draft.days.includes(day) ? 'border-brand bg-brand text-white' : 'border-line text-ink-2 hover:border-brand/40'}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Day starts
          <input type="time" step={60 * 30} value={draft.start} onChange={(e) => (setSaved(false), setDraft((d) => ({ ...d, start: e.target.value })))} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Day ends
          <input type="time" step={60 * 30} value={draft.end} onChange={(e) => (setSaved(false), setDraft((d) => ({ ...d, end: e.target.value })))} className={inputClass} />
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">The week starts on</legend>
        <div className="flex flex-wrap gap-2">
          {WEEK_STARTS.map((w) => (
            <label
              key={w.value}
              className={`relative flex cursor-pointer select-none items-center rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))] [@media(pointer:coarse)]:min-h-11 ${
                draft.weekStart === w.value ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30'
              }`}
            >
              <input type="radio" name="nst-week-start" className="sr-only" checked={draft.weekStart === w.value} onChange={() => (setSaved(false), setDraft((d) => ({ ...d, weekStart: w.value })))} />
              {w.label}
            </label>
          ))}
        </div>
      </fieldset>
      <SaveRow onSave={submit} pending={save.isPending} saved={saved} problem={problem} label="Save working time" />
      {companyCount > 1 && wt.own ? (
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => (setSaved(false), setProblem(null), follow.mutate())} disabled={follow.isPending} className="[@media(pointer:coarse)]:!min-h-11">
            Use the site’s working time
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
