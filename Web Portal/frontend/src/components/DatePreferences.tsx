import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { preferencesApi, type DatePreferences as Prefs } from '../api/preferences';
import { DATE_PREFS_KEY, useDateSettings } from '../lib/useDatePrefs';
import { SearchableSelect } from './ui/SearchableSelect';

const WEEK_STARTS: { value: 0 | 1 | 6; label: string }[] = [
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

/** Every IANA time zone the browser knows (a short list where it can't say). */
function timeZones(): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
  return all?.length ? all : ['UTC', 'Asia/Muscat', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Karachi', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles'];
}

/**
 * Settings → Calendar & dates: the first day of the week and, if wanted, an own time zone for the
 * calendar (otherwise the company's, which an administrator sets). Saved for the person, so it
 * follows them to any device.
 */
export function DatePreferences() {
  const qc = useQueryClient();
  const { companyTimeZone, ownTimeZone, weekStart } = useDateSettings();
  const [problem, setProblem] = useState<string | null>(null);
  const zones = useMemo(() => timeZones().map((z) => ({ value: z, label: z.replace(/_/g, ' '), hint: z === companyTimeZone ? 'company' : undefined })), [companyTimeZone]);
  const save = useMutation({
    mutationFn: (patch: Partial<Prefs>) => preferencesApi(apiClient).set(patch),
    onMutate: async (patch) => {
      setProblem(null);
      await qc.cancelQueries({ queryKey: DATE_PREFS_KEY });
      const prev = qc.getQueryData<Prefs>(DATE_PREFS_KEY);
      qc.setQueryData<Prefs>(DATE_PREFS_KEY, { timeZone: prev?.timeZone ?? null, weekStart: prev?.weekStart ?? null, ...patch });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(DATE_PREFS_KEY, ctx?.prev);
      setProblem('Couldn’t save that change. Please try again.');
    },
    onSuccess: (saved) => {
      qc.setQueryData(DATE_PREFS_KEY, saved);
      void qc.invalidateQueries({ queryKey: ['calendar'] });
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-ink">Week starts on</div>
          <div className="text-xs text-ink-2">The first column of the calendar.</div>
        </div>
        <div role="group" aria-label="Week starts on" className="inline-flex rounded-lg border border-line p-0.5">
          {WEEK_STARTS.map((w) => (
            <button
              key={w.value}
              type="button"
              onClick={() => save.mutate({ weekStart: w.value })}
              aria-pressed={weekStart === w.value}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${weekStart === w.value ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:text-ink'}`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-md">
          <div className="text-sm font-medium text-ink">Time zone for the calendar</div>
          <div className="text-xs text-ink-2">
            {ownTimeZone ? `Your own: ${ownTimeZone}. ` : `Dates use the company time zone (${companyTimeZone}). `}
            Due dates without a time always stay on their day.
          </div>
        </div>
        <div className="flex w-full flex-col items-end gap-1.5 sm:w-72">
          <div className="w-full">
            <SearchableSelect
              ariaLabel="Time zone"
              value={ownTimeZone ?? ''}
              placeholder="Company default"
              options={zones}
              onChange={(v) => v && save.mutate({ timeZone: v })}
            />
          </div>
          {ownTimeZone ? (
            <button type="button" onClick={() => save.mutate({ timeZone: null })} className="text-xs font-semibold text-brand hover:underline">
              Use the company time zone
            </button>
          ) : null}
        </div>
      </div>
      {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
    </div>
  );
}
