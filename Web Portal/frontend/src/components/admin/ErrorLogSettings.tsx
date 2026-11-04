import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { systemSettingsApi } from '../../api/system-settings';
import { Toggle } from '../ui/Toggle';
import { buttonClass } from '../ui/Button';
import { TOUCH_TALL } from '../../lib/touch';

export const COLLECT_KEY = 'errorLog.collectBrowserErrors';

/**
 * System Settings → Error log (1.22.4): the way to the Error log, and the "Collect browser errors"
 * switch (on unless an administrator turns it off). Off, pages stop sending their errors, blocked
 * files and slow pages; the server's own errors are still kept.
 */
export function ErrorLogSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi(apiClient).list() });
  const settings = Array.isArray(q.data) ? q.data : [];
  const on = settings.find((s) => s.key === COLLECT_KEY)?.value !== false;
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: boolean) => systemSettingsApi(apiClient).set(COLLECT_KEY, value),
    onSuccess: () => {
      setProblem(null);
      void qc.invalidateQueries({ queryKey: ['system-settings'] });
      void qc.invalidateQueries({ queryKey: ['app-config'] });
    },
    onError: () => setProblem('Couldn’t save the setting. Please try again.'),
  });
  return (
    <section className="card p-5" aria-labelledby="error-log-admin-heading">
      <h2 id="error-log-admin-heading" className="eyebrow mb-1">Error log</h2>
      <p className="mb-4 text-sm text-ink-2">
        Errors in people’s browsers — and pages that were blocked or slow — are sent here with the server’s own errors, so a problem in the field can be traced.
        Never what anyone typed. Kept 30 days.
      </p>
      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      <div className="flex items-center justify-between gap-3 border-t border-line py-3">
        <div>
          <div id="collect-browser-errors-label" className="text-sm font-medium text-ink">Collect browser errors</div>
          <div id="collect-browser-errors-hint" className="text-xs text-ink-2">Off: pages stop sending; server errors are still kept.</div>
        </div>
        <Toggle on={on} disabled={q.isLoading || save.isPending} onChange={() => save.mutate(!on)} label="Collect browser errors" describedBy="collect-browser-errors-hint" />
      </div>
      <div className="border-t border-line pt-3">
        <Link to="/admin/error-log" className={buttonClass('secondary', 'sm', TOUCH_TALL)}>
          Open the error log
        </Link>
      </div>
    </section>
  );
}
