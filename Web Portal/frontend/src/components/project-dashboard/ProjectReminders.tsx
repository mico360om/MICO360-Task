import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { notificationSettingsApi, type ProjectReminders as Reminders } from '../../api/notification-settings';
import { ApiError } from '../../lib/api-client';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Toggle';
import { scheduleText } from '../notify-settings/schedule-words';

const field =
  'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:!min-h-11';
const key = (projectId: string) => ['project-reminders', projectId] as const;

/**
 * A project's reminders (Notification & Scheduling centre): which of the company's reminder schedules its
 * tasks follow, and its own escalation numbers (in working days) — for whoever runs it and admins. A
 * task can still pick its own schedule.
 */
/** `settingsAllowed` (Release B x Manager View): false hides the card where the page says the project's settings are closed. */
export function ProjectReminders({ projectId, readOnly, settingsAllowed = true }: { projectId: string; readOnly?: boolean; settingsAllowed?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key(projectId), queryFn: () => notificationSettingsApi(apiClient).projectReminders(projectId) });
  const data = q.data && Array.isArray(q.data.schedules) ? q.data : null;
  const [scheduleId, setScheduleId] = useState('');
  const [own, setOwn] = useState(false);
  const [steps, setSteps] = useState({ step1Days: 3, step2Days: 5 });
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const seed = data ? JSON.stringify([data.scheduleId, data.escalationDays, data.companyEscalation]) : '';
  useEffect(() => {
    if (!data) return;
    setScheduleId(data.scheduleId ?? '');
    setOwn(!!data.escalationDays);
    setSteps(data.escalationDays ?? data.companyEscalation);
  }, [seed]);

  const save = useMutation({
    mutationFn: () => notificationSettingsApi(apiClient).saveProjectReminders(projectId, { scheduleId: scheduleId || null, escalationDays: own ? steps : null }),
    onMutate: () => (setSaved(false), setProblem(null)),
    onSuccess: (r: Reminders) => {
      qc.setQueryData(key(projectId), r);
      setSaved(true);
    },
    onError: (e) => setProblem(e instanceof ApiError && e.status < 500 && e.message ? e.message : 'Couldn’t save the reminders. Please try again.'),
  });

  if (!data?.canEdit || !settingsAllowed) return null;
  const inUse = data.schedules.find((s) => s.id === scheduleId) ?? data.schedules.find((s) => s.isDefault);
  const good = (n: number) => Number.isInteger(n) && n >= 1 && n <= 60;
  const submit = () => {
    if (own && (!good(steps.step1Days) || !good(steps.step2Days))) return setProblem('Each step is whole working days, from 1 to 60.');
    save.mutate();
  };

  return (
    <section className="card card-pad mt-4" aria-labelledby={`project-reminders-${projectId}`}>
      <h2 id={`project-reminders-${projectId}`} className="eyebrow mb-1">
        Reminders
      </h2>
      <p className="mb-3 text-sm text-ink-2">When this project’s tasks remind their people, and when an overdue task is escalated (working days).</p>
      <label className="flex max-w-md flex-col gap-1 text-xs font-medium text-ink-2">
        Reminder schedule
        <select value={scheduleId} onChange={(e) => (setSaved(false), setScheduleId(e.target.value))} disabled={!!readOnly} className={field}>
          <option value="">The company’s default ({data.schedules.find((s) => s.isDefault)?.name ?? 'Standard'})</option>
          {data.schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {inUse ? <p className="mt-1 text-xs text-ink-2">{scheduleText(inUse.steps)}</p> : null}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm text-ink">
          Its own escalation steps <span className="text-ink-2">(the company’s: {data.companyEscalation.step1Days} / {data.companyEscalation.step2Days})</span>
        </span>
        <Toggle on={own} onChange={() => (setSaved(false), setOwn((o) => !o))} label="Its own escalation steps" disabled={!!readOnly} />
      </div>
      {own ? (
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Step 1 (to whoever runs it) after
            <input type="number" min={1} max={60} value={steps.step1Days} onChange={(e) => (setSaved(false), setSteps((s) => ({ ...s, step1Days: Math.round(Number(e.target.value)) })))} className={`${field} w-24`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Step 2 (to the admins) after … more
            <input type="number" min={1} max={60} value={steps.step2Days} onChange={(e) => (setSaved(false), setSteps((s) => ({ ...s, step2Days: Math.round(Number(e.target.value)) })))} className={`${field} w-24`} />
          </label>
        </div>
      ) : null}
      {!readOnly ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={save.isPending} className="[@media(pointer:coarse)]:!min-h-11">
            Save reminders
          </Button>
          {saved ? <p role="status" className="text-sm text-ink-2">Saved.</p> : null}
          {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
