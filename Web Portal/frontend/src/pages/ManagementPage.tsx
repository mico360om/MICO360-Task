import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { managementAccessKey, managementApi, managementOverviewKey, type ItemQuery, type ManagementFilters as Filters, type ManagementOverview } from '../api/management';
import { ApiError } from '../lib/api-client';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { LoadError } from '../components/ui/LoadError';
import { StatTile } from '../components/StatTile';
import { ManagementFilters } from '../components/management/ManagementFilters';
import { HealthSection } from '../components/management/HealthSection';
import { InspectionsSection } from '../components/management/InspectionsSection';
import { PeopleSection } from '../components/management/PeopleSection';
import { TrendsSection } from '../components/management/TrendsSection';
import { ItemsSheet } from '../components/management/ItemsSheet';
import { plural } from '../components/management/parts';
import { downloadBlob, fileNameOf } from '../lib/download';
import { dayMonth, filtersFromParams, withFilters } from '../lib/management';
import { useManagementAccess } from '../lib/useManagementAccess';

/** Read again every five minutes while open (and when the window comes back into focus). */
const REFRESH_MS = 5 * 60_000;

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the management overview" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-2xl" />
        ))}
      </div>
      <div className="skeleton h-64 rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="skeleton h-56 rounded-2xl" />
        <div className="skeleton h-56 rounded-2xl" />
      </div>
    </div>
  );
}

/** "updated 10:00" in the company time zone. */
const clock = (at: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));

/**
 * Management: one page for leadership — every project's health (red / amber / green with the reasons,
 * worst first), inspections, people's workload and weekly trends, with filters kept in the address, a
 * PDF for meetings, and every number opening the list behind it. Administrators see every project;
 * the people who run a project see the projects they run.
 */
export function ManagementPage() {
  const [params, setParams] = useSearchParams();
  // The filters live in the address, mirrored here so a tick box or a period responds at once: the
  // router applies address changes as a transition, which would leave a controlled control unticked
  // until it caught up. Back/forward (the address changing on its own) is picked up during render.
  const fromAddress = filtersFromParams(params);
  const addressKey = withFilters(new URLSearchParams(), fromAddress).toString();
  const [filters, setLocalFilters] = useState<Filters>(fromAddress);
  // Only an actual change of the address resets them (never the render before the address catches up).
  const [lastAddress, setLastAddress] = useState(addressKey);
  if (addressKey !== lastAddress) {
    setLastAddress(addressKey);
    setLocalFilters(fromAddress);
  }
  const setFilters = (f: Filters) => {
    setLocalFilters(f);
    setParams((prev) => withFilters(prev, f), { replace: true });
  };
  const openTask = (id: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('task', id);
      return next;
    });

  const qc = useQueryClient();
  const q = useQuery({
    queryKey: managementOverviewKey(filters),
    queryFn: () => managementApi(apiClient).overview(filters),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    // A refusal is an answer, not a hiccup: don't ask again and again.
    retry: (n, err) => !(err instanceof ApiError && err.status === 403) && n < 2,
    retryDelay: 400,
  });
  const data: ManagementOverview | undefined = q.data;
  // The server says no (they no longer run a project): the sidebar link goes too.
  const refused = q.error instanceof ApiError && q.error.status === 403;
  useEffect(() => {
    if (refused) void qc.invalidateQueries({ queryKey: managementAccessKey });
  }, [refused, qc]);
  const scopeWords = data?.scope === 'RUN' ? 'the projects you run' : 'all projects';

  const [sheet, setSheet] = useState<{ query: ItemQuery; label: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openList = (query: ItemQuery, from: HTMLElement, label = from.getAttribute('aria-label')?.replace(/: show the list$/, '') ?? 'The list') => {
    opener.current = from;
    setSheet({ query, label });
  };

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProblem, setPdfProblem] = useState<string | null>(null);
  async function downloadPdf() {
    setPdfBusy(true);
    setPdfProblem(null);
    try {
      const blob = await managementApi(apiClient).pdf(filters);
      downloadBlob(fileNameOf(blob) ?? `management-overview-${data?.today ?? 'today'}.pdf`, blob);
    } catch {
      setPdfProblem('Couldn’t make the PDF. Please try again.');
    } finally {
      setPdfBusy(false);
    }
  }

  const t = data?.tiles;
  const tile = (o: { label: string; value: number | string; hint?: string; tone?: 'brand' | 'success' | 'warning' | 'info' | 'danger'; query?: ItemQuery; count: number; action: string }) => (
    <StatTile
      label={o.label}
      value={o.value}
      hint={o.hint}
      tone={o.tone}
      {...(o.query && o.count > 0 ? { onClick: () => setSheetFromTile(o.query!, o.action), actionLabel: `${o.action}: show the list` } : {})}
    />
  );
  function setSheetFromTile(query: ItemQuery, label: string) {
    opener.current = document.activeElement as HTMLElement | null;
    setSheet({ query, label });
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Management"
        subtitle="Every project’s health, inspections, people and trends."
        actions={
          <Button variant="secondary" size="sm" loading={pdfBusy} disabled={!data} onClick={() => void downloadPdf()} className="[@media(pointer:coarse)]:!min-h-11">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            Download PDF
          </Button>
        }
      />
      {pdfProblem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{pdfProblem}</p> : null}
      {data ? (
        <p className="mb-3 text-sm text-ink-2">
          {data.scope === 'ALL' ? 'All projects' : 'The projects you run'} · last {data.period.weeks} weeks ({dayMonth(data.period.from)} – {dayMonth(data.period.to)}) ·{' '}
          <span>updated {clock(data.generatedAt, data.timeZone)}</span>
        </p>
      ) : null}

      <ManagementFilters filters={filters} projects={data?.options.projects ?? []} owners={data?.options.owners ?? []} onChange={setFilters} />

      {refused ? (
        <div role="alert" className="card p-5 text-sm text-ink">
          <p className="font-semibold">You no longer run any projects, so the Management page isn’t open to you.</p>
          <p className="mt-1 text-ink-2">It shows the projects you own or manage. An administrator can name you as a project’s manager.</p>
          <Link to="/dashboard" className="tap mt-2 font-semibold text-brand hover:underline [@media(pointer:coarse)]:!min-h-11">Go to the dashboard</Link>
        </div>
      ) : q.isError && !data ? (
        <LoadError what="the management overview" onRetry={() => void q.refetch()} />
      ) : !data || !t ? (
        <Skeleton />
      ) : (
        <div className={`space-y-4 transition-opacity ${q.isFetching && q.isPlaceholderData ? 'opacity-60' : ''}`}>
          {q.isError ? <LoadError what="the latest figures" onRetry={() => void q.refetch()} /> : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tile({ label: 'Projects', value: t.projects, hint: `${t.red} red · ${t.amber} amber · ${t.green} green`, tone: 'brand', query: { metric: 'projects' }, count: t.projects, action: `${plural(t.projects, 'project')}` })}
            {tile({ label: 'In red', value: t.red, hint: 'Need attention now', tone: 'danger', query: { metric: 'projects', rag: 'RED' }, count: t.red, action: `${plural(t.red, 'project')} in red` })}
            {tile({ label: 'Late tasks', value: t.lateTasks, hint: 'Open and past their due day', tone: 'danger', query: { metric: 'late-tasks' }, count: t.lateTasks, action: `${plural(t.lateTasks, 'late task')} in ${scopeWords}` })}
            {tile({ label: 'Missing checks', value: t.missingChecks, hint: 'Inspections not done on time', tone: 'warning', query: { metric: 'missing-checks' }, count: t.missingChecks, action: `${plural(t.missingChecks, 'missing check')}` })}
            {tile({ label: 'Checks done', value: `${t.checksDone} of ${t.checksDue}`, hint: t.checksDoneLate ? `${t.checksDoneLate} done late` : 'In the period', tone: 'success', query: { metric: 'checks-due' }, count: t.checksDue, action: `${t.checksDone} of ${plural(t.checksDue, 'check')} done` })}
            {/* A percentage, not a list: shown, not a button. */}
            {tile({ label: 'Pass rate', value: t.passRate === null ? '—' : `${t.passRate}%`, hint: 'Items passed in the period', tone: 'info', count: 0, action: '' })}
            {tile({ label: 'Overloaded this week', value: t.overloadedPeople, hint: `Over the daily limit of ${data.workload.limit}`, tone: 'warning', query: { metric: 'people-overloaded' }, count: t.overloadedPeople, action: `${plural(t.overloadedPeople, 'person', 'people')} overloaded this week` })}
            {tile({ label: 'Open follow-ups', value: t.openFollowUps, hint: 'From failed inspection items', tone: 'brand', query: { metric: 'follow-ups' }, count: t.openFollowUps, action: `${plural(t.openFollowUps, 'open follow-up')}` })}
          </div>

          <HealthSection rows={data.projects} today={data.today} timeZone={data.timeZone} onOpen={openList} onOpenTask={openTask} chosenHidden={filters.projectIds.length > 0} />
          <div className="grid gap-4 xl:grid-cols-2">
            <InspectionsSection data={data.inspections} onOpen={openList} />
            <PeopleSection people={data.people} week={data.workload.week} limit={data.workload.limit} onOpen={openList} />
          </div>
          <TrendsSection weeks={data.trends} />
        </div>
      )}

      {sheet ? (
        <ItemsSheet
          filters={filters}
          query={sheet.query}
          label={sheet.label}
          timeZone={data?.timeZone ?? 'UTC'}
          workloadWeek={data?.workload.week ?? ''}
          onOpenTask={openTask}
          onClose={() => {
            setSheet(null);
            opener.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** /management: the page for administrators and the people who run a project; anyone else goes to the dashboard. */
export function ManagementRoute() {
  const { allowed, ready, failed, retry } = useManagementAccess();
  if (failed) {
    // A network problem is not a "no": say so, and offer to try again.
    return (
      <div role="alert" className="card mx-auto mt-8 max-w-md p-5 text-sm text-ink">
        <p className="font-semibold">Couldn’t check whether you can see this page.</p>
        <p className="mt-1 text-ink-2">Check your connection, then try again.</p>
        <Button variant="secondary" size="sm" className="mt-3 [@media(pointer:coarse)]:!min-h-11" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-sm text-ink-3" role="status" aria-live="polite">
        <span className="animate-pulse motion-reduce:animate-none">Loading…</span>
      </div>
    );
  }
  return allowed ? <ManagementPage /> : <Navigate to="/dashboard" replace />;
}
