import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { StatTile } from '../components/StatTile';
import { BarChart } from '../components/BarChart';
import { LineChart } from '../components/LineChart';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { apiClient } from '../api/client';
import { reportsApi, type ReportFormat, type ReportKind } from '../api/reports';
import { downloadBlob } from '../lib/download';

// ── Date-range helpers (UTC day keys, matching the server's buckets) ──
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const todayKey = () => new Date().toISOString().slice(0, 10);
const shiftKey = (key: string, deltaDays: number) => new Date(Date.parse(`${key}T00:00:00Z`) + deltaDays * DAY_MS).toISOString().slice(0, 10);
/** "2000-01-05" → "Jan 5" (timezone-safe, no Date parsing). */
const shortDay = (key: string) => {
  const [, m, d] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
};
const cumulative = (vals: number[]) => {
  let sum = 0;
  return vals.map((v) => (sum += v));
};
const RANGE_PRESETS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

// Status colours reference the shared design tokens so they match the Kanban board
// and the Dashboard chart (theme-aware, on-brand — not raw Tailwind hues).
const CATEGORY: Record<string, { label: string; color: string }> = {
  BACKLOG: { label: 'Backlog', color: 'rgb(var(--c-cat-backlog))' },
  TODO: { label: 'To Do', color: 'rgb(var(--c-cat-todo))' },
  IN_PROGRESS: { label: 'In Progress', color: 'rgb(var(--c-cat-progress))' },
  BLOCKED: { label: 'Blocked', color: 'rgb(var(--c-cat-blocked))' },
  REVIEW: { label: 'Review', color: 'rgb(var(--c-cat-review))' },
  DONE: { label: 'Done', color: 'rgb(var(--c-cat-done))' },
};

const EXPORT_REPORTS: { value: ReportKind; label: string; file: string }[] = [
  { value: 'projects', label: 'Project performance', file: 'project-performance' },
  { value: 'status', label: 'Task status', file: 'task-status' },
  { value: 'workload', label: 'Employee workload', file: 'employee-workload' },
  { value: 'timeseries', label: 'Completion trend', file: 'completion-trend' },
];
const FORMATS: { format: ReportFormat; label: string; ext: string }[] = [
  { format: 'csv', label: 'CSV', ext: 'csv' },
  { format: 'xls', label: 'Excel', ext: 'xls' },
  { format: 'pdf', label: 'PDF', ext: 'pdf' },
];

const MINI_TONE: Record<string, string> = {
  brand: 'text-brand',
  success: 'text-success',
  info: 'text-info',
  danger: 'text-danger',
};
function MiniStat({ label, value, tone = 'brand' }: { label: string; value: string | number; tone?: keyof typeof MINI_TONE }) {
  return (
    <div className="rounded-xl border border-line bg-ground/40 p-3">
      <div className={`font-display text-2xl font-bold ${MINI_TONE[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-ink-2">{label}</div>
    </div>
  );
}

function PctBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 flex-none overflow-hidden rounded-full bg-ground">
        <div className="h-full rounded-full bg-brand-sheen" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="tabular-nums text-xs font-semibold text-ink">{pct}%</span>
    </div>
  );
}

export function ReportsPage() {
  const projectsQ = useQuery({ queryKey: ['report-projects'], queryFn: () => reportsApi(apiClient).projectPerformance() });
  const statusQ = useQuery({ queryKey: ['report-status'], queryFn: () => reportsApi(apiClient).status() });
  const workloadQ = useQuery({ queryKey: ['report-workload'], queryFn: () => reportsApi(apiClient).workload() });
  const completionQ = useQuery({ queryKey: ['report-completion'], queryFn: () => reportsApi(apiClient).completion() });

  const [exportKind, setExportKind] = useState<ReportKind>('projects');
  const [exporting, setExporting] = useState<ReportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [to, setTo] = useState(todayKey());
  const [from, setFrom] = useState(shiftKey(todayKey(), -29));

  const trendsQ = useQuery({
    queryKey: ['report-timeseries', from, to, projectFilter],
    queryFn: () => reportsApi(apiClient).timeSeries({ from, to, projectId: projectFilter || undefined }),
  });

  function setPreset(days: number) {
    const t = todayKey();
    setTo(t);
    setFrom(shiftKey(t, -(days - 1)));
  }

  async function exportReport(format: ReportFormat, ext: string) {
    setExporting(format);
    setExportError(null);
    try {
      const params = exportKind === 'timeseries' ? { from, to, projectId: projectFilter || undefined } : {};
      const blob = await reportsApi(apiClient).exportFile(exportKind, format, params);
      const file = EXPORT_REPORTS.find((r) => r.value === exportKind)?.file ?? exportKind;
      downloadBlob(`${file}.${ext}`, blob);
    } catch {
      setExportError('Couldn’t export the report. Please try again.');
    } finally {
      setExporting(null);
    }
  }

  const allRows = projectsQ.data ?? [];
  const projectOptions = [{ value: '', label: 'All projects' }, ...allRows.map((r) => ({ value: r.projectId, label: r.projectName }))];
  const rows = projectFilter ? allRows.filter((r) => r.projectId === projectFilter) : allRows;
  const totals = rows.reduce(
    (a, r) => ({ total: a.total + r.total, completed: a.completed + r.completed, overdue: a.overdue + r.overdue }),
    { total: 0, completed: 0, overdue: 0 },
  );
  const completionPct = totals.total ? Math.round((totals.completed / totals.total) * 100) : 0;
  const completion = completionQ.data;
  const statusBars = Object.entries(statusQ.data ?? {})
    .map(([cat, n]) => ({ label: CATEGORY[cat]?.label ?? cat, value: n, color: CATEGORY[cat]?.color }))
    .sort((a, b) => b.value - a.value);
  const allWorkload = [...(workloadQ.data ?? [])].sort((a, b) => b.assigned - a.assigned);
  const teamOptions = [{ value: '', label: 'All team' }, ...allWorkload.map((w) => ({ value: w.userId, label: w.username }))];
  const workload = teamFilter ? allWorkload.filter((w) => w.userId === teamFilter) : allWorkload;
  const workloadBars = workload.map((w) => ({ label: w.username, value: w.assigned }));
  const filtersActive = !!(projectFilter || teamFilter);

  // ── Time series (trends, burndown, velocity) ──
  const points = trendsQ.data?.points ?? [];
  const trendLabels = points.map((p) => shortDay(p.date));
  const completedCum = cumulative(points.map((p) => p.completed));
  const createdCum = cumulative(points.map((p) => p.created));
  const completionSeries = [
    { name: 'Completed', color: 'rgb(var(--c-cat-done))', values: completedCum, area: true },
    { name: 'Created', color: 'rgb(var(--c-ink-3))', values: createdCum },
  ];
  const overdueSeries = [{ name: 'Overdue', color: 'rgb(var(--c-danger))', values: points.map((p) => p.overdue), area: true }];
  const burndownSeries = [
    { name: 'Remaining', color: 'rgb(var(--c-brand))', values: points.map((p) => p.remaining), area: true },
    { name: 'Ideal', color: 'rgb(var(--c-ink-3))', values: points.map((p) => p.ideal), dashed: true },
  ];
  const velocityBars = (trendsQ.data?.velocity ?? []).map((w) => ({ label: shortDay(w.weekStart), value: w.completed }));
  const totalCompletedInRange = points.reduce((s, p) => s + p.completed, 0);
  const totalCreatedInRange = points.reduce((s, p) => s + p.created, 0);
  const latestOverdue = points.length ? points[points.length - 1]!.overdue : 0;
  const velocityPerWeek = trendsQ.data?.velocityPerWeek ?? 0;

  const isLoading = projectsQ.isLoading || statusQ.isLoading;
  const isError = projectsQ.isError || statusQ.isError;

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Reports"
        subtitle="Task delivery, project progress and team workload — with exports."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-xs font-medium text-ink-2 sm:inline">Export</span>
            <div className="w-40">
              <SearchableSelect ariaLabel="Report to export" value={exportKind} onChange={(v) => setExportKind(v as ReportKind)} options={EXPORT_REPORTS} />
            </div>
            {FORMATS.map(({ format, label, ext }) => (
              <Button
                key={format}
                variant="secondary"
                size="sm"
                onClick={() => exportReport(format, ext)}
                disabled={exporting !== null}
                loading={exporting === format}
              >
                {exporting !== format ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
                ) : null}
                {exporting === format ? 'Exporting…' : label}
              </Button>
            ))}
          </div>
        }
      />

      {exportError ? (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{exportError}</p>
      ) : null}

      {isError ? (
        <p role="alert" className="text-danger">
          Couldn’t load reports (admin only). <button className="font-semibold underline" onClick={() => { projectsQ.refetch(); statusQ.refetch(); workloadQ.refetch(); completionQ.refetch(); }}>Retry</button>
        </p>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Filters */}
          <div className="card flex flex-wrap items-center gap-2 p-2.5">
            <span className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Filter</span>
            <div className="w-44 max-w-full"><SearchableSelect ariaLabel="Filter by project" value={projectFilter} onChange={setProjectFilter} options={projectOptions} /></div>
            <div className="w-44 max-w-full"><SearchableSelect ariaLabel="Filter by team member" value={teamFilter} onChange={setTeamFilter} options={teamOptions} /></div>
            {filtersActive ? (
              <button onClick={() => { setProjectFilter(''); setTeamFilter(''); }} className="rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink">Clear</button>
            ) : null}
            {projectFilter ? <span className="ml-auto text-xs text-ink-3">Project scope · {allRows.find((r) => r.projectId === projectFilter)?.projectName}</span> : null}
          </div>

          {/* Summary tiles */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Total tasks" value={totals.total} tone="brand" hint={`${rows.length} project${rows.length === 1 ? '' : 's'}`} />
            <StatTile label="Completed" value={totals.completed} tone="success" hint={`${completionPct}% completion`} />
            <StatTile label="Overdue" value={totals.overdue} tone="danger" hint={totals.total ? `${Math.round((totals.overdue / totals.total) * 100)}% of tasks` : '—'} />
            <StatTile label="On-time rate" value={completion ? `${completion.onTimeRate}%` : '—'} tone="info" hint={completion ? `${completion.onTime} on time · ${completion.late} late` : undefined} />
          </div>

          {/* Status breakdown + completion timeliness */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="eyebrow mb-3">Tasks by status</h2>
              <BarChart data={statusBars} />
            </section>
            <section className="card p-5">
              <h2 className="eyebrow mb-4">On-time delivery</h2>
              {completion ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-end gap-6">
                    <div><div className="font-display text-3xl font-bold text-success">{completion.onTime}</div><div className="text-xs text-ink-2">On time</div></div>
                    <div><div className="font-display text-3xl font-bold text-danger">{completion.late}</div><div className="text-xs text-ink-2">Late</div></div>
                    <div><div className="font-display text-3xl font-bold text-ink-2">{completion.unclassified}</div><div className="text-xs text-ink-2">No due date</div></div>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-ground">
                    <div className="h-full bg-success" style={{ width: `${completion.onTimeRate}%` }} />
                  </div>
                  <p className="text-sm text-ink-2">
                    <span className="font-semibold text-ink">{completion.onTimeRate}%</span> of completed tasks with a due date were delivered on time.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-2">No completion data yet.</p>
              )}
            </section>
          </div>

          {/* Trends, burndown & velocity — the time dimension */}
          <section className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h2 className="eyebrow">Trends &amp; burndown</h2>
                <p className="mt-0.5 text-xs text-ink-3">
                  {shortDay(from)} – {shortDay(to)}
                  {projectFilter ? ` · ${allRows.find((r) => r.projectId === projectFilter)?.projectName}` : ' · all projects'}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded-lg border border-line">
                  {RANGE_PRESETS.map((p) => {
                    const active = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1 === p.days && to === todayKey();
                    return (
                      <button
                        key={p.days}
                        onClick={() => setPreset(p.days)}
                        className={`px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'bg-brand text-white' : 'text-ink-2 hover:bg-ground'}`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <input type="date" aria-label="From date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand" />
                <span className="text-xs text-ink-3">to</span>
                <input type="date" aria-label="To date" value={to} min={from} max={todayKey()} onChange={(e) => e.target.value && setTo(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand" />
              </div>
            </div>

            {trendsQ.isError ? (
              <p role="alert" className="mt-4 text-sm text-danger">Couldn’t load trends. <button className="font-semibold underline" onClick={() => trendsQ.refetch()}>Retry</button></p>
            ) : trendsQ.isLoading ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-48 rounded-xl" />)}</div>
            ) : (
              <>
                {/* Window stats */}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniStat label="Completed in range" value={totalCompletedInRange} tone="success" />
                  <MiniStat label="New tasks in range" value={totalCreatedInRange} tone="info" />
                  <MiniStat label="Velocity" value={`${velocityPerWeek}/wk`} tone="brand" />
                  <MiniStat label="Overdue now" value={latestOverdue} tone="danger" />
                </div>

                {/* Charts */}
                <div className="mt-4 grid gap-5 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-ink">Completion over time</h3>
                    <p className="mb-2 text-xs text-ink-3">Cumulative tasks created vs completed — are we keeping up?</p>
                    <LineChart ariaLabel="Completion over time" labels={trendLabels} series={completionSeries} />
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-ink">Overdue trend</h3>
                    <p className="mb-2 text-xs text-ink-3">Open tasks past their due date, each day.</p>
                    <LineChart ariaLabel="Overdue trend" labels={trendLabels} series={overdueSeries} />
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-ink">Burndown</h3>
                    <p className="mb-2 text-xs text-ink-3">Remaining open work vs an ideal linear burn.</p>
                    <LineChart ariaLabel="Burndown" labels={trendLabels} series={burndownSeries} />
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-ink">Velocity</h3>
                    <p className="mb-2 text-xs text-ink-3">Tasks completed per week ({velocityPerWeek}/wk average).</p>
                    <BarChart data={velocityBars} />
                  </div>
                </div>
              </>
            )}
          </section>

          {/* Project progress */}
          <section className="card overflow-x-auto">
            <h2 className="eyebrow p-4 pb-0">Project progress</h2>
            {rows.length === 0 ? (
              <p className="p-4 text-sm text-ink-2">No projects yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                    <th className="p-3">Project</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3 text-right">Completed</th>
                    <th className="p-3 text-right">Pending</th>
                    <th className="p-3 text-right">Overdue</th>
                    <th className="p-3">Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => b.completionPct - a.completionPct).map((r) => (
                    <tr key={r.projectId} className="border-b border-line last:border-0">
                      <td className="p-3 font-medium text-ink">{r.projectName}</td>
                      <td className="p-3 text-right tabular-nums">{r.total}</td>
                      <td className="p-3 text-right tabular-nums text-success">{r.completed}</td>
                      <td className="p-3 text-right tabular-nums">{r.total - r.completed}</td>
                      <td className="p-3 text-right tabular-nums text-danger">{r.overdue}</td>
                      <td className="p-3"><PctBar pct={r.completionPct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Employee workload */}
          <section className="card overflow-x-auto">
            <h2 className="eyebrow p-4 pb-0">Employee workload {teamFilter ? `· ${allWorkload.find((w) => w.userId === teamFilter)?.username}` : ''}</h2>
            {workload.length === 0 ? (
              <p className="p-4 text-sm text-ink-2">No workload data.</p>
            ) : (
              <>
                <div className="border-b border-line p-4">
                  <p className="mb-2 text-xs font-medium text-ink-2">Assigned tasks by team member</p>
                  <BarChart data={workloadBars} />
                </div>
                <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                    <th className="p-3">Employee</th>
                    <th className="p-3 text-right">Assigned</th>
                    <th className="p-3 text-right">Completed</th>
                    <th className="p-3 text-right">Overdue</th>
                    <th className="p-3">Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.map((w) => (
                    <tr key={w.userId} className="border-b border-line last:border-0">
                      <td className="p-3 font-medium text-ink">{w.username}</td>
                      <td className="p-3 text-right tabular-nums">{w.assigned}</td>
                      <td className="p-3 text-right tabular-nums text-success">{w.completed}</td>
                      <td className="p-3 text-right tabular-nums text-danger">{w.overdue}</td>
                      <td className="p-3"><PctBar pct={w.assigned ? Math.round((w.completed / w.assigned) * 100) : 0} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
