import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { notificationsApi, type NotificationPreferences } from '../../api/notifications';
import { useManagementAccess } from '../../lib/useManagementAccess';
import { Toggle } from '../ui/Toggle';

const PREFS_KEY = ['notification-prefs'];

/**
 * Settings → Weekly management summary: for the people who can see the Management page, the short
 * summary of their projects sent on the first working morning of each week — on unless turned off.
 */
export function WeeklySummarySettings() {
  const { allowed } = useManagementAccess();
  const qc = useQueryClient();
  const prefsQ = useQuery({ queryKey: PREFS_KEY, queryFn: () => notificationsApi(apiClient).getPreferences(), enabled: allowed });
  const [problem, setProblem] = useState<string | null>(null);
  const on = prefsQ.data?.weeklySummary !== false;
  const save = useMutation({
    mutationFn: (next: boolean) => notificationsApi(apiClient).setPreferences({ weeklySummary: next }),
    onMutate: async (next) => {
      setProblem(null);
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      const prev = qc.getQueryData<NotificationPreferences>(PREFS_KEY);
      qc.setQueryData<NotificationPreferences>(PREFS_KEY, { muted: [], ...prev, weeklySummary: next });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PREFS_KEY, ctx.prev);
      setProblem('Couldn’t save that change. Please try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PREFS_KEY }),
  });
  if (!allowed) return null;
  return (
    <section className="card p-5 lg:col-span-2" aria-labelledby="weekly-summary-heading">
      <h2 id="weekly-summary-heading" className="eyebrow mb-1">Weekly management summary</h2>
      <p className="mb-4 text-sm text-ink-2">
        A short email on the first working morning of each week, at your daily email time: which projects are red or amber and why, late
        tasks, missing checks and who has the most late work — with a link to the Management page.
      </p>
      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
        <div className="min-w-0">
          <div id="weekly-summary-label" className="text-sm font-medium text-ink">Send me the weekly summary</div>
          <div className="text-xs text-ink-2">Only the projects you can see on the Management page.</div>
        </div>
        <Toggle on={on} onChange={() => save.mutate(!on)} label="Weekly management summary email" disabled={prefsQ.isLoading} />
      </div>
    </section>
  );
}
