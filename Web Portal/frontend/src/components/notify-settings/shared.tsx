import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { ApiError } from '../../lib/api-client';
import { NOTIFICATION_SETTINGS_KEY, notificationSettingsApi, type CompanyNotificationSettings, type NotificationPolicy } from '../../api/notification-settings';
import { Button } from '../ui/Button';

/** What every tab gets: the company and its settings as loaded. */
export interface TabProps {
  companyId: string;
  data: CompanyNotificationSettings;
  /** Active companies on the site (the picker shows with 2+). */
  companyCount: number;
}

export const settingsKey = (companyId: string) => [...NOTIFICATION_SETTINGS_KEY, companyId] as const;

/** The server's words for a refusal, else a general one. */
export function problemOf(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.message ? e.message : fallback;
}

/** Save some sections of the company's policy: "Saved." after, the problem in role=alert otherwise. */
export function usePolicySave(companyId: string) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (patch: Partial<NotificationPolicy>) => notificationSettingsApi(apiClient).savePolicy(companyId, patch),
    onMutate: () => {
      setSaved(false);
      setProblem(null);
    },
    onSuccess: (policy) => {
      qc.setQueryData<CompanyNotificationSettings>(settingsKey(companyId), (d) => (d ? { ...d, policy } : d));
      setSaved(true);
    },
    onError: (e) => setProblem(problemOf(e, 'Couldn’t save these settings. Please try again.')),
  });
  return { save: (patch: Partial<NotificationPolicy>) => m.mutate(patch), pending: m.isPending, saved, problem, touch: () => setSaved(false) };
}

/** A tab's Save button with its "Saved." status and its problem. */
export function SaveRow({ onSave, pending, saved, problem, label = 'Save' }: { onSave: () => void; pending: boolean; saved: boolean; problem: string | null; label?: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button onClick={onSave} disabled={pending} className="[@media(pointer:coarse)]:!min-h-11">
        {pending ? 'Saving…' : label}
      </Button>
      {saved ? (
        <p role="status" className="text-sm text-ink-2">
          Saved.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:!min-h-11';

/** A whole number of working days (1–60), with its label and a short help line. */
export function DaysField({ label, value, onChange, help, min = 1, max = 60 }: { label: string; value: number; onChange: (n: number) => void; help?: ReactNode; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-ink">
      {label}
      <span className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Math.round(Number(e.target.value)))}
          className={`${inputClass} w-24`}
        />
        <span className="text-xs font-normal text-ink-2">working days</span>
      </span>
      {help ? <span className="text-xs font-normal text-ink-2">{help}</span> : null}
    </label>
  );
}

/** A whole number of working days within bounds, else null. */
export const goodDays = (n: number, min = 1, max = 60): boolean => Number.isInteger(n) && n >= min && n <= max;

/** A card inside a tab. */
export function Panel({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="card card-pad" aria-labelledby={id}>
      <h2 id={id} className="eyebrow mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}
