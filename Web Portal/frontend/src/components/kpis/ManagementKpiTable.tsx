import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { kpisApi, managementKpisKey, type KpiMetric, type ManagementKpis } from '../../api/kpis';
import type { ManagementFilters } from '../../api/management';
import { Button } from '../ui/Button';
import { LoadError } from '../ui/LoadError';
import { ProjectAvatar } from '../ProjectAvatar';
import { downloadBlob, fileNameOf } from '../../lib/download';
import { formatKpiValue } from '../../lib/kpi-format';
import { TOUCH_TALL } from '../../lib/touch';
import { LIGHT_LOOK, PeriodPicker, usePeriodParam } from './kpi-ui';

type SortKey = 'name' | KpiMetric;
/** Worst first when sorting by a KPI: red, amber, green, then no target and no figure. */
const LIGHT_RANK = { red: 0, amber: 1, green: 2, none: 3, nodata: 4 } as const;

/**
 * The Management page's KPI table: every project in the reader's scope (administrators: all; whoever runs
 * projects: theirs), each KPI's figure with its light in words, for the period; sortable by any column
 * (a KPI sorts worst first); Excel, and a PDF with a page per project.
 */
export function ManagementKpiTable({ filters, today }: { filters: ManagementFilters; today: string }) {
  const [period, setPeriod] = usePeriodParam();
  const [customOpen, setCustomOpen] = useState(false);
  const q = useQuery({ queryKey: managementKpisKey(filters, period), queryFn: () => kpisApi(apiClient).management(filters, period), placeholderData: keepPreviousData, staleTime: 60_000 });
  // A table only when the answer is one (never a half-read page).
  const data: ManagementKpis | undefined = q.data && Array.isArray(q.data.rows) && q.data.period ? q.data : undefined;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    let d: number;
    if (sort.key === 'name') d = a.project.name.localeCompare(b.project.name, 'en', { numeric: true, sensitivity: 'base' });
    else {
      const fa = a.figures[sort.key];
      const fb = b.figures[sort.key];
      d = LIGHT_RANK[fa?.light ?? 'nodata'] - LIGHT_RANK[fb?.light ?? 'nodata'] || (fa?.value ?? Infinity) - (fb?.value ?? Infinity);
    }
    return sort.desc ? -d : d;
  });
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: false }));
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none');

  async function file(kind: 'xlsx' | 'pdf') {
    setBusy(kind);
    setProblem(null);
    try {
      const blob = kind === 'xlsx' ? await kpisApi(apiClient).managementXlsx(filters, period) : await kpisApi(apiClient).managementPdf(filters, period);
      downloadBlob(fileNameOf(blob) ?? `management-kpis-${today}.${kind}`, blob);
    } catch {
      setProblem('Couldn’t make the file. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card card-pad" aria-labelledby="mgmt-kpis" data-kpis="management">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="mgmt-kpis" className="eyebrow">
            Project KPIs
          </h2>
          <p className="text-sm text-ink-2" aria-live="polite">
            {data ? `${data.period.label} · sort by a KPI to see the furthest off target first` : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker value={period} onChange={setPeriod} today={data?.today ?? today} customOpen={customOpen} onCustomOpen={setCustomOpen} />
          <Button size="sm" variant="secondary" disabled={!data} loading={busy === 'xlsx'} onClick={() => void file('xlsx')} className={TOUCH_TALL}>
            Excel
          </Button>
          <Button size="sm" variant="secondary" disabled={!data} loading={busy === 'pdf'} onClick={() => void file('pdf')} className={TOUCH_TALL}>
            PDF
          </Button>
        </div>
      </div>
      {problem ? (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {problem}
        </p>
      ) : null}
      {q.isError && !data ? (
        <LoadError what="the KPIs" onRetry={() => void q.refetch()} />
      ) : !data ? (
        <div className="skeleton h-48 rounded-xl" aria-hidden="true" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-2">No projects match these filters.</p>
      ) : (
        <div className={`overflow-x-auto transition-opacity ${q.isFetching && q.isPlaceholderData ? 'opacity-60' : ''}`}>
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">Each project’s KPIs for {data.period.label}, with their lights</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold text-ink-3">
                <th scope="col" aria-sort={ariaSort('name')} className="py-2 pe-3">
                  <button type="button" onClick={() => sortBy('name')} className={`font-semibold hover:text-ink ${TOUCH_TALL}`}>
                    Project
                  </button>
                </th>
                {data.metrics.map((m) => (
                  <th key={m.metric} scope="col" aria-sort={ariaSort(m.metric)} className="py-2 pe-3 text-right">
                    <button type="button" onClick={() => sortBy(m.metric)} className={`text-right font-semibold hover:text-ink ${TOUCH_TALL}`}>
                      {m.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.project.id} className="border-b border-line/70">
                  <th scope="row" className="py-2 pe-3 text-left font-medium">
                    <Link to={`/projects/${encodeURIComponent(r.project.id)}?tab=kpis`} className={`inline-flex min-w-0 items-center gap-2 text-ink hover:text-brand ${TOUCH_TALL}`}>
                      <ProjectAvatar project={r.project} size="xs" />
                      <bdi className="truncate">{r.project.name}</bdi>
                    </Link>
                  </th>
                  {data.metrics.map((m) => {
                    const f = r.figures[m.metric]!;
                    const look = LIGHT_LOOK[f.light];
                    return (
                      <td key={m.metric} className="py-2 pe-3 text-right tabular-nums">
                        {/* Review I8: the light in words under the figure — never colour alone. */}
                        <span className="inline-flex flex-col items-end">
                          <span className={f.value === null ? 'text-ink-3' : f.light === 'red' || f.light === 'amber' ? `font-semibold ${look.text}` : 'text-ink'}>{formatKpiValue(m.metric, m.unit, f.value)}</span>
                          {f.light === 'green' || f.light === 'amber' || f.light === 'red' ? (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${look.text}`}>
                              <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${look.dot}`} />
                              {f.words}
                            </span>
                          ) : null}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-2">On target: at or better than the target. Close: within its amber band (10% of the target unless set). Off target: further off. Targets are the company’s unless a project sets its own.</p>
        </div>
      )}
    </section>
  );
}
