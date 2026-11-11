import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { kpisApi, personKpiItemsKey, personKpisKey, type KpiTile } from '../api/kpis';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadError } from '../components/ui/LoadError';
import { Avatar } from '../components/ui/Avatar';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { KpiItemsSheet } from '../components/kpis/KpiItemsSheet';
import { KpiTileCard, PeriodPicker, TrendNote, usePeriodParam } from '../components/kpis/kpi-ui';
import { ApiError } from '../lib/api-client';
import { todayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/company-clock';
import { usePageName } from '../lib/page-meta';
import { useAuthStore } from '../stores/auth-store';

const SCOPE_WORDS = {
  self: 'Your own tasks in every project you’re on.',
  admin: 'Their tasks in every project (you’re an administrator).',
  manager: 'Their tasks in the projects you run only.',
} as const;

/**
 * My performance (/performance) and a person's KPIs (/performance/:userId) — owner 2: each person sees
 * their own; whoever runs a project sees the people on it, counting only the projects they run; an
 * administrator sees everyone's; colleagues never see each other's (the server refuses). No ranking.
 */
export function PerformancePage() {
  const { userId: param } = useParams();
  const myId = useAuthStore((s) => s.user?.id);
  const self = !param || param === myId;
  const userId = self ? 'me' : param!;
  const [period, setPeriod] = usePeriodParam();
  const [customOpen, setCustomOpen] = useState(false);
  const timeZone = useCompanyTimeZone();
  const [, setParams] = useSearchParams();
  const q = useQuery({
    queryKey: personKpisKey(userId, period),
    queryFn: () => (self ? kpisApi(apiClient).me(period) : kpisApi(apiClient).person(userId, period)),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: (n, err) => !(err instanceof ApiError && (err.status === 403 || err.status === 404)) && n < 2,
  });
  const data = q.data;
  usePageName(self ? 'My performance' : data ? `${data.person.name} · Performance` : 'Performance');
  const [sheet, setSheet] = useState<KpiTile | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const today = data?.today ?? todayKey(timeZone);
  const refused = q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404);
  const openTask = (id: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('task', id);
      return next;
    });

  return (
    <div data-page="performance">
      <PageHeader eyebrow="Workspace" title={self ? 'My performance' : (data?.person.name ?? 'Performance')} subtitle={self ? 'Your KPIs: on time, days late, workload and more. Only you, the managers of your projects and administrators see them.' : 'Their KPIs, as their manager or an administrator sees them.'} />
      {refused ? (
        <div role="alert" className="card card-pad text-sm text-ink">
          <p className="font-semibold">You can’t see this person’s performance.</p>
          <p className="mt-1 text-ink-2">Only the person, the managers of their projects and administrators can.</p>
          <Link to="/performance" className="mt-2 inline-block font-semibold text-brand hover:underline [@media(pointer:coarse)]:!min-h-11">
            Open my performance
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {data && !self ? <Avatar name={data.person.name} src={data.person.avatarUrl} size="md" /> : null}
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink" aria-live="polite">
                  {data ? data.period.label : 'Loading…'}
                </p>
                {data ? <p className="text-xs text-ink-2">{SCOPE_WORDS[data.scope]}{!data.person.active ? ' This account is not active.' : ''}</p> : null}
              </div>
            </div>
            <PeriodPicker value={period} onChange={setPeriod} today={today} customOpen={customOpen} onCustomOpen={setCustomOpen} />
          </div>
          {q.isError && !data ? (
            <LoadError what="the KPIs" onRetry={() => void q.refetch()} />
          ) : !data ? (
            <div aria-busy="true" aria-label="Loading the KPIs" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton h-40 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className={`space-y-4 transition-opacity ${q.isFetching && q.isPlaceholderData ? 'opacity-60' : ''}`}>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="KPIs">
                {data.tiles.map((t) => (
                  <li key={t.metric} className="min-w-0">
                    <KpiTileCard
                      tile={t}
                      points={data.trend.points}
                      onOpen={(tile, from) => {
                        opener.current = from;
                        setSheet(tile);
                      }}
                    />
                  </li>
                ))}
              </ul>
              <TrendNote kind={data.trend.kind} points={data.trend.points} />
              <section className="card card-pad" aria-labelledby="perf-projects">
                <h2 id="perf-projects" className="eyebrow mb-2">
                  Projects counted
                </h2>
                {data.projects.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {data.projects.map((p) => (
                      <li key={p.id}>
                        <Link to={`/projects/${encodeURIComponent(p.id)}`} className="inline-flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-sm text-ink hover:bg-ground [@media(pointer:coarse)]:!min-h-11">
                          <ProjectAvatar project={p} size="xs" />
                          <bdi>{p.name}</bdi>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-2">No projects yet.</p>
                )}
              </section>
            </div>
          )}
        </>
      )}
      {sheet && data ? (
        <KpiItemsSheet
          title={sheet.label}
          queryKey={personKpiItemsKey(data.person.id, sheet.metric, period)}
          load={() => kpisApi(apiClient).personItems(data.person.id, sheet.metric, period)}
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
