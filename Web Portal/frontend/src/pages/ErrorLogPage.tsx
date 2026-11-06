import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { Toggle } from '../components/ui/Toggle';
import { apiClient } from '../api/client';
import { errorLogApi, type ErrorGroup, type ErrorKindFilter, type ErrorLogPage as ErrorLogPageData, type ErrorOccurrence, type ErrorRange } from '../api/error-log';
import { dateTimeText } from '../lib/day-words';
import { relativeTime } from '../lib/relative-time';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';
import { DatabaseCheckLine } from '../components/admin/DatabaseCheckLine';
import { KIND_FILTERS, KIND_WORDS, RANGES, browserText, databaseText, detailText, isNewSince, lastTimeText, peopleText, personText, placeText, slowTimingText, timesText, topFrameText } from '../components/admin/error-log-words';

const segment = (active: boolean) =>
  `rounded-lg px-3 py-1 text-sm font-medium transition-colors ${TOUCH_SQUARE} ${active ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`;
const chip = (active: boolean) =>
  `inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${TOUCH_TALL} ${active ? 'bg-brand text-white shadow-brand' : 'border border-line text-ink-2 hover:bg-ground'}`;

/** The search box asks the server once typing pauses. */
function useSettled(value: string, ms = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * System Settings → Error log (1.22.4, administrators only): what went wrong in people's browsers —
 * errors, requests blocked on the way, files and scripts that were blocked, slow pages — and on the
 * server (failed requests, background jobs). The same error is one row with a count; opening a row
 * shows the site's own file:line and the latest occurrences; "Mark as fixed" hides it until it
 * happens again in a newer version. Kept 30 days.
 */
export function ErrorLogPage() {
  const timeZone = useCompanyTimeZone();
  const qc = useQueryClient();
  const api = errorLogApi(apiClient);
  const [kind, setKind] = useState<ErrorKindFilter>('all');
  const [range, setRange] = useState<ErrorRange>('7d');
  const [search, setSearch] = useState('');
  const [showFixed, setShowFixed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useSettled(search);

  // The previous visit, asked once when the page opens (the server keeps this one as the next "previous").
  const visitQ = useQuery({ queryKey: ['error-log', 'visit'], queryFn: () => api.visit(), staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, retry: false });
  const previousVisit = visitQ.data ?? null;

  const listQ = useInfiniteQuery({
    queryKey: ['error-log', 'list', { kind, range, q, status: showFixed ? 'fixed' : 'open' }],
    queryFn: ({ pageParam }) => api.list({ kind, range, q, status: showFixed ? 'fixed' : 'open', before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const groups = useMemo(() => {
    const seen = new Set<string>();
    return (listQ.data?.pages ?? []).flatMap((p) => p.groups).filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  }, [listQ.data]);
  const counts = listQ.data?.pages[0]?.counts;
  // 1.23.1: the server's database self-check (null until it ran; absent from an older server).
  const databaseCheck = listQ.data?.pages[0]?.databaseCheck ?? null;
  // 1.23.2 "Check again": the check runs now; its result replaces the line in every list already loaded.
  const checkAgain = useMutation({
    mutationFn: () => api.checkDatabase(),
    onSuccess: (fresh) =>
      qc.setQueriesData<InfiniteData<ErrorLogPageData>>({ queryKey: ['error-log', 'list'] }, (old) =>
        old ? { ...old, pages: old.pages.map((p, i) => (i === 0 ? { ...p, databaseCheck: fresh } : p)) } : old,
      ),
  });
  const newCount = groups.filter((g) => isNewSince(g, previousVisit)).length;
  const filtered = kind !== 'all' || q.trim() !== '' || range !== '7d';

  return (
    <div>
      <PageHeader
        eyebrow={<Link to="/admin/settings" className="hover:text-ink hover:underline">System Settings</Link>}
        title="Error Log"
        subtitle="What went wrong in people’s browsers and on the server — kept 30 days."
      />

      {databaseCheck ? (
        <DatabaseCheckLine
          check={databaseCheck}
          onCheckAgain={() => {
            if (!checkAgain.isPending) checkAgain.mutate();
          }}
          checking={checkAgain.isPending}
          checkFailed={checkAgain.isError}
        />
      ) : null}

      <div className="card mb-4 flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="When" className="inline-flex gap-0.5 rounded-xl border border-line bg-surface p-0.5">
            {RANGES.map((r) => (
              <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)} className={segment(range === r.key)}>
                {r.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <Toggle on={showFixed} onChange={() => setShowFixed((v) => !v)} label="Show the ones marked fixed" />
            <span aria-hidden="true">Marked fixed</span>
          </label>
        </div>
        {/* One line that scrolls sideways on a phone; wrapped from sm up. */}
        <div role="group" aria-label="Kinds" className="-my-1 flex gap-1.5 overflow-x-auto py-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          {KIND_FILTERS.map((f) => {
            const n = counts?.[f.key] ?? 0;
            return (
              <button key={f.key} type="button" title={f.hint} aria-pressed={kind === f.key} aria-label={`${f.label}, ${n}`} onClick={() => setKind(f.key)} className={chip(kind === f.key)}>
                <span>{f.label}</span>
                <span aria-hidden="true" className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums ${kind === f.key ? 'bg-white/25 text-white' : 'bg-ground text-ink-2'}`}>
                  {n > 999 ? '999+' : n}
                </span>
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={100}
          placeholder="Search messages, files, pages and jobs"
          aria-label="Search the error log"
          className={`w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand ${TOUCH_TALL}`}
        />
      </div>

      {previousVisit && newCount > 0 && !showFixed ? (
        <p role="status" className="mb-3 text-sm text-ink-2">
          <span className="font-semibold text-brand">{newCount} new</span> since your last visit on {dateTimeText(previousVisit, timeZone)}.
        </p>
      ) : null}

      <div className="card overflow-hidden">
        {listQ.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : listQ.isError ? (
          <LoadError className="p-4" what="the error log" onRetry={() => void listQ.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            bare
            title={showFixed ? 'Nothing marked fixed here' : filtered ? 'Nothing matches' : 'No errors — all quiet'}
            description={
              showFixed
                ? 'Rows marked as fixed show here until they happen again in a newer version.'
                : filtered
                  ? 'Try another kind, a longer time or other words.'
                  : 'Errors in people’s browsers and on the server will show here.'
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <ErrorRow
                key={g.id}
                group={g}
                open={openId === g.id}
                isNew={isNewSince(g, previousVisit)}
                timeZone={timeZone}
                onToggle={() => setOpenId((id) => (id === g.id ? null : g.id))}
                onChanged={() => {
                  setOpenId(null);
                  void qc.invalidateQueries({ queryKey: ['error-log', 'list'] });
                  void qc.invalidateQueries({ queryKey: ['error-log', 'detail', g.id] });
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {listQ.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" className={TOUCH_TALL} loading={listQ.isFetchingNextPage} onClick={() => void listQ.fetchNextPage()}>
            Show older ones
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ErrorRow({ group: g, open, isNew, timeZone, onToggle, onChanged }: { group: ErrorGroup; open: boolean; isNew: boolean; timeZone: string; onToggle: () => void; onChanged: () => void }) {
  const words = KIND_WORDS[g.kind];
  const panelId = `error-row-${g.id}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={`flex w-full flex-col gap-1.5 px-4 py-3 text-start transition-colors hover:bg-ground focus-visible:bg-ground ${TOUCH_TALL}`}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={words.tone}>{words.label}</Badge>
          {isNew ? <Badge tone="brand">New</Badge> : null}
          {g.reopenedAt && g.status === 'OPEN' ? <Badge tone="neutral">Back again</Badge> : null}
          <span className="ms-auto text-xs text-ink-3" title={dateTimeText(g.lastSeenAt, timeZone)}>
            {relativeTime(g.lastSeenAt)}
          </span>
        </span>
        <span dir="auto" className="line-clamp-2 break-words font-medium text-ink">{g.title}</span>
        {/* 1.23.3: a slow request — where the last time's wait went (the server, the database or the network). */}
        {g.timing ? <span className="break-words text-xs text-ink-2">{lastTimeText(g.timing)}</span> : null}
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">
          <span>{timesText(g.count)}</span>
          <span>{peopleText(g)}</span>
          {g.page ? <span className="break-all font-mono text-[11px]">{g.page}</span> : null}
          {g.version ? <span>Version {g.version}</span> : null}
          <span>First seen {dateTimeText(g.firstSeenAt, timeZone)}</span>
        </span>
      </button>
      {open ? <ErrorDetails id={panelId} groupId={g.id} status={g.status} timeZone={timeZone} onChanged={onChanged} /> : null}
    </li>
  );
}

function ErrorDetails({ id, groupId, status, timeZone, onChanged }: { id: string; groupId: string; status: 'OPEN' | 'FIXED'; timeZone: string; onChanged: () => void }) {
  const api = errorLogApi(apiClient);
  const q = useQuery({ queryKey: ['error-log', 'detail', groupId], queryFn: () => api.detail(groupId) });
  const [problem, setProblem] = useState<string | null>(null);
  const fix = useMutation({
    mutationFn: () => (status === 'FIXED' ? api.notFixed(groupId) : api.markFixed(groupId)),
    onSuccess: () => {
      setProblem(null);
      onChanged();
    },
    onError: () => setProblem('Couldn’t save that. Please try again.'),
  });
  const latest = q.data?.events[0];
  const frame = q.data ? topFrameText(q.data.group) : '';
  // A database error (1.22.5): what the database said the latest time it said something.
  const said = q.data?.events.find((e) => e.database)?.database ?? '';
  return (
    <div id={id} className="border-t border-line bg-ground/60 px-4 py-3">
      {q.isLoading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : q.isError || !q.data ? (
        <LoadError what="this error" onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          {frame ? (
            <p className="text-sm text-ink-2">
              Where: <code className="break-all rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-ink">{frame}</code>
            </p>
          ) : null}
          {said ? (
            <p role="note" aria-label="What the database said (latest)" className="text-sm text-ink-2">
              Database said: <code className="break-all rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-ink">{said}</code>
            </p>
          ) : null}
          {latest?.stack ? (
            <div>
              <h3 className="eyebrow mb-1">Stack (latest)</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre rounded-lg border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed text-ink" tabIndex={0} aria-label="Stack of the latest occurrence">
                {latest.stack}
              </pre>
            </div>
          ) : null}
          <div>
            <h3 className="eyebrow mb-1">Latest occurrences</h3>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
              {q.data.events.map((e) => (
                <Occurrence key={e.id} e={e} timeZone={timeZone} />
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant={status === 'FIXED' ? 'secondary' : 'primary'} className={TOUCH_TALL} loading={fix.isPending} onClick={() => fix.mutate()}>
              {status === 'FIXED' ? 'Not fixed' : 'Mark as fixed'}
            </Button>
            <span className="text-xs text-ink-2">
              {status === 'FIXED'
                ? `Marked fixed${q.data.group.fixedInVersion ? ` in version ${q.data.group.fixedInVersion}` : ''}: it shows again if it happens in a newer version.`
                : 'It is hidden until it happens again in a newer version.'}
            </span>
            {problem ? (
              <span role="alert" className="text-sm text-danger">
                {problem}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Occurrence({ e, timeZone }: { e: ErrorOccurrence; timeZone: string }) {
  const facts = [placeText(e), browserText(e), e.version ? `Version ${e.version}` : '', e.screen ? `Window ${e.screen.replace('x', '×')}` : '', e.count > 1 ? `${timesText(e.count)} in one visit` : '', detailText(e.detail)].filter(Boolean);
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2 text-xs">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-ink">{dateTimeText(e.at, timeZone)}</span>
        <span dir="auto" className="text-ink-2">{personText(e)}</span>
      </span>
      {e.kind !== 'ERROR' && e.kind !== 'SERVER' ? <span dir="auto" className="break-words text-ink-2">{e.message}</span> : null}
      {e.timing ? <span className="break-words text-ink-2">{slowTimingText(e.timing)}</span> : null}
      {e.resource ? <span className="break-all font-mono text-[11px] text-ink-3">{e.resource}</span> : null}
      {e.database ? <span className="break-all font-mono text-[11px] text-ink-3">{databaseText(e)}</span> : null}
      <span className="break-words text-ink-3">{facts.join(' · ')}</span>
    </li>
  );
}
