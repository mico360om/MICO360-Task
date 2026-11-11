import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { KPI_ROOT, companyTargetsKey, kpisApi, type TargetChange } from '../api/kpis';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadError } from '../components/ui/LoadError';
import { TargetsEditor } from '../components/kpis/TargetsEditor';
import { ApiError } from '../lib/api-client';
import { usePageName } from '../lib/page-meta';
import { TOUCH_TALL } from '../lib/touch';

/**
 * System Settings → KPI targets (administrators): each company's default targets (owner 3: e.g. on time
 * 85%, days late ≤ 2) — every project uses them unless whoever runs it sets its own.
 */
export function KpiTargetsPage() {
  usePageName('KPI targets');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const asked = params.get('company');
  const q = useQuery({ queryKey: companyTargetsKey(asked), queryFn: () => kpisApi(apiClient).companyTargets(asked) });
  const data = q.data;
  const save = useMutation({
    mutationFn: (changes: TargetChange[]) => kpisApi(apiClient).saveCompanyTargets(data?.companyId ?? null, changes),
    onSuccess: (next) => {
      qc.setQueryData(companyTargetsKey(asked), next);
      void qc.invalidateQueries({ queryKey: [...KPI_ROOT, 'project'] });
      void qc.invalidateQueries({ queryKey: [...KPI_ROOT, 'management'] });
      void qc.invalidateQueries({ queryKey: [...KPI_ROOT, 'person'] });
    },
  });
  return (
    <div data-page="kpi-targets">
      <PageHeader eyebrow="Admin" title="KPI targets" subtitle="The company’s default targets for the project and people KPIs; a project’s manager can set the project’s own." />
      <p className="mb-3 text-sm">
        <Link to="/admin/settings" className="font-semibold text-brand hover:underline">
          ← System Settings
        </Link>
      </p>
      {data && data.companies.length > 1 ? (
        <label className="mb-4 flex max-w-sm flex-col gap-1 text-xs font-medium text-ink-2">
          Company
          <select
            value={data.companyId ?? ''}
            onChange={(e) => setParams((p) => {
              const n = new URLSearchParams(p);
              n.set('company', e.target.value);
              return n;
            })}
            className={`rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink ${TOUCH_TALL}`}
          >
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <section className="card card-pad max-w-4xl">
        {q.isError ? (
          <LoadError what="the targets" onRetry={() => void q.refetch()} />
        ) : data ? (
          <>
            {save.isSuccess ? (
              <p role="status" className="mb-3 rounded-lg bg-ground px-3 py-2 text-sm text-ink">
                Saved. Every project without its own target uses these now.
              </p>
            ) : null}
            <TargetsEditor metrics={data.metrics} level="company" busy={save.isPending} error={save.error ? (save.error instanceof ApiError ? save.error.message : 'Couldn’t save the targets.') : null} onSave={(c) => save.mutate(c)} />
          </>
        ) : (
          <div className="skeleton h-72 rounded-xl" aria-hidden="true" />
        )}
      </section>
    </div>
  );
}
