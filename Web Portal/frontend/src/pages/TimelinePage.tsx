import { useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { planningApi, timelineKey, type TimelineProject } from '../api/planning';
import { PageTitle } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { LoadError } from '../components/ui/LoadError';
import { ProjectAvatar } from '../components/ProjectAvatar';
import { useMediaQuery } from '../components/calendar/calendar-ui';
import { TimelineChart, detailKey, type TimelineDetail } from '../components/timeline/TimelineChart';
import { TimelineDetails } from '../components/timeline/TimelineDetails';
import { BAR_TONE, Glyph, HEAT, HealthPill, ICONS } from '../components/timeline/parts';
import { useDateSettings } from '../lib/useDatePrefs';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useNow } from '../lib/useNow';
import { todayKey } from '../lib/due-date';
import { weekDays } from '../lib/calendar';
import {
  TIMELINE_SORTS,
  TIMELINE_VIEWS,
  busyTotals,
  filterTimeline,
  heatScale,
  milestoneLine,
  ownerOptions,
  rangeFor,
  readTimelineState,
  shiftAnchor,
  shortDay,
  sortTimeline,
  statusLine,
  targetLine,
  timelineSummary,
  writeTimelineState,
  type TimelineShow,
  type TimelineSort,
  type TimelineState,
} from '../lib/timeline';

const iconButton = 'grid h-9 w-9 flex-none place-items-center rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:border-brand hover:text-brand';
const SELECT_BOX =
  'flex h-9 min-w-0 flex-[1_1_9rem] items-center gap-1.5 rounded-xl border border-line bg-surface ps-3 text-sm transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 sm:flex-none';
const SELECT = 'h-full min-w-0 cursor-pointer rounded-xl bg-transparent pe-2 text-sm font-semibold text-ink outline-none';

/** "4 Oct 2026 – 2 Jan 2027". */
const period = (from: string, to: string) => `${shortDay(from, '0000')} – ${shortDay(to, '0000')}`;

function Card({ icon, tone, value, label, pressed, onToggle, ring }: { icon: ReactNode; tone: string; value: number | string; label: string; pressed?: boolean; onToggle?: () => void; ring?: string }) {
  const inner = (
    <>
      <span className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${tone}`}>
        <Glyph size={18}>{icon}</Glyph>
      </span>
      <span className="min-w-0 text-start">
        <span className="block font-display text-xl font-extrabold leading-tight text-ink tabular-nums">{value}</span>
        <span className="block text-xs text-ink-2">{label}</span>
      </span>
    </>
  );
  const box = 'flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card';
  if (!onToggle) return <div className={box}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pressed}
      title={pressed ? 'Show every project again' : 'Show only these projects'}
      className={`${box} transition-colors hover:border-brand/30 ${pressed ? `ring-2 ${ring}` : ''}`}
    >
      {inner}
    </button>
  );
}

function PhoneList({ projects, today }: { projects: TimelineProject[]; today: string }) {
  return (
    <ul aria-label="Projects" className="grid gap-2">
      {projects.map((p) => (
        <li key={p.id}>
          <Link to={`/projects/${p.id}`} className="card block p-3.5 transition-colors hover:border-brand/30">
            <span className="flex items-center gap-2.5">
              <ProjectAvatar project={p} size="md" />
              <span className="min-w-0 flex-1 truncate font-bold text-ink">{p.name}</span>
              <HealthPill health={p.health} />
            </span>
            <span className="mt-2.5 flex items-center gap-2">
              <span
                role="progressbar"
                aria-label={`${p.name}: ${p.progress}% done`}
                aria-valuenow={p.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ground"
              >
                <span className={`block h-full rounded-full ${BAR_TONE[p.health].fill}`} style={{ width: `${p.progress}%` }} />
              </span>
              <span className="text-xs font-bold tabular-nums text-ink">{p.progress}%</span>
            </span>
            <span className="mt-2 block truncate text-xs text-ink-2">{milestoneLine(p, today)}</span>
            <span className={`block text-xs ${p.health === 'late' ? 'font-semibold text-danger' : 'text-ink-2'}`}>{targetLine(p, today)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Legend({ labels }: { labels: string[] }) {
  const sw = 'inline-block h-2.5 w-5 flex-none rounded-sm';
  return (
    <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${sw} bg-info`} />✓ On track</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${sw} bg-warning`} />⚠ At risk — less done than time used</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`${sw} hatch-late`} />⏱ Late — hatched part is past the target</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2 w-2 rotate-45 bg-surface ring-2 ring-ink" />Milestone (filled once reached)</li>
      <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2 w-2 rounded-[2px] bg-meeting" />Meeting</li>
      <li className="ms-auto">Busy weeks:</li>
      {labels.map((l, i) => (
        <li key={l} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block h-2.5 w-3.5 rounded-sm ${HEAT[(i + 1) as 1 | 2 | 3 | 4]}`} />
          {l}
        </li>
      ))}
    </ul>
  );
}

/**
 * Timeline: every open project on one chart — its bar from start to target filled to the share done,
 * at risk when less is done than time used, late with the part past the target hatched, its
 * milestones and meetings — with five summary cards (Late and At risk filter the rows), the open
 * tasks due each week, and a plain list on a phone. View, place, owner, sort and the card filter are
 * kept in the address.
 */
export function TimelinePage() {
  const [params, setParams] = useSearchParams();
  const state = readTimelineState(params);
  const update = (changes: Partial<TimelineState>) => setParams((prev) => writeTimelineState(prev, changes));
  const { weekStart } = useDateSettings();
  const timeZone = useCompanyTimeZone();
  const now = useNow(60_000);
  const today = todayKey(timeZone, now);
  const thisWeek = weekDays(today, weekStart)[0]!;
  const anchor = state.at ?? thisWeek;
  const range = rangeFor(state.view, anchor);
  const phone = useMediaQuery('(max-width: 639px)');

  const query = useQuery({
    queryKey: timelineKey(range.from, range.to, weekStart, today),
    queryFn: () => planningApi(apiClient).timeline({ ...range, weekStart }),
    placeholderData: keepPreviousData,
    // Read again whenever the page is opened: meetings and project dates change on other pages.
    staleTime: 0,
  });
  const data = query.data;
  const all = useMemo(() => data?.projects ?? [], [data]);
  const owners = useMemo(() => ownerOptions(all), [all]);
  const owner = owners.some((o) => o.id === state.owner) ? state.owner : '';
  const byOwner = useMemo(() => filterTimeline(all, { owner, show: '' }), [all, owner]);
  const summary = timelineSummary(byOwner);
  const shown = sortTimeline(filterTimeline(byOwner, { owner: '', show: state.show }), state.sort);
  const busy = busyTotals(shown, data?.weeks.length ?? 0);
  const scale = heatScale(busy);

  // The open details and the bar or marker that opened them (they sit right after it; focus returns there).
  const [detail, setDetail] = useState<TimelineDetail | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openKey = detail ? detailKey(detail) : null;
  const detailProject = detail ? shown.find((p) => p.id === detail.projectId) ?? null : null;

  function openDetail(next: TimelineDetail, el: HTMLElement) {
    if (openKey === detailKey(next)) {
      setDetail(null);
      return;
    }
    trigger.current = el;
    setDetail(next);
  }

  const toggle = (show: Exclude<TimelineShow, ''>) => {
    setDetail(null);
    update({ show: state.show === show ? '' : show });
  };
  const loading = query.isLoading;
  const ready = !!data && !query.isError;

  return (
    <div>
      <div className="relative z-20 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 animate-fade-in-up">
        <PageTitle eyebrow="Workspace" title="Timeline" className="flex-[1_1_12rem]" />
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="inline-flex rounded-xl border border-line bg-surface p-0.5">
            {TIMELINE_VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => update({ view: v.value })}
                aria-pressed={state.view === v.value}
                className={`min-h-[2rem] rounded-lg px-3 text-sm font-semibold transition-colors ${state.view === v.value ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => update({ at: shiftAnchor(state.view, anchor, -1) })} aria-label="Earlier" title="Earlier" className={iconButton}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button type="button" onClick={() => update({ at: null })} className="h-9 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand">
              Today
            </button>
            <button type="button" onClick={() => update({ at: shiftAnchor(state.view, anchor, 1) })} aria-label="Later" title="Later" className={iconButton}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:rotate-180"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
          <div className={SELECT_BOX}>
            <label htmlFor="tl-owner" className="flex-none text-ink-2">Owner</label>
            <select id="tl-owner" value={owner} onChange={(e) => update({ owner: e.target.value })} className={`${SELECT} flex-1 sm:max-w-[11rem]`}>
              <option value="">Anyone</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div className={SELECT_BOX}>
            <label htmlFor="tl-sort" className="flex-none text-ink-2">Sort</label>
            <select id="tl-sort" value={state.sort} onChange={(e) => update({ sort: e.target.value as TimelineSort })} className={`${SELECT} flex-1`}>
              {TIMELINE_SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <section aria-label="Summary" className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Card icon={ICONS.list} tone="bg-info-soft text-info" value={ready ? summary.open : '–'} label="Open projects" />
        <Card icon={ICONS.clock} tone="bg-danger-soft text-danger" value={ready ? summary.late : '–'} label="Late · target passed" pressed={state.show === 'late'} onToggle={() => toggle('late')} ring="ring-danger" />
        <Card icon={ICONS.warning} tone="bg-warning-soft text-warning" value={ready ? summary.atRisk : '–'} label="At risk" pressed={state.show === 'at-risk'} onToggle={() => toggle('at-risk')} ring="ring-warning" />
        <Card icon={ICONS.diamond} tone="bg-ground text-ink" value={ready ? summary.milestonesSoon : '–'} label="Milestones in 30 days" />
        <Card icon={ICONS.meeting} tone="bg-meeting/15 text-meeting" value={ready ? summary.meetingsThisWeek : '–'} label="Meetings this week" />
      </section>

      {/* Announced as the cards, owner or weeks change. */}
      <p role="status" className="mb-3 min-h-[1.25rem] text-sm text-ink-2">
        {ready ? `${statusLine(summary, state.show, shown.length)} · ${period(data.from, data.to)}` : ''}
      </p>

      {loading ? (
        <div className="card p-4" aria-busy="true" aria-label="Loading the timeline">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <div className="skeleton h-8 w-8 flex-none rounded-lg" />
              <div className="skeleton h-4 w-40" />
              <div className="skeleton ms-6 h-5 flex-1" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <LoadError what="the timeline" onRetry={() => void query.refetch()} />
      ) : !data ? null : all.length === 0 ? (
        <EmptyState title="No open projects" description="Projects that are not completed or archived appear here, along their dates." />
      ) : shown.length === 0 ? (
        <EmptyState
          title={state.show === 'late' ? 'No late projects' : state.show === 'at-risk' ? 'No projects at risk' : 'No projects for this owner'}
          action={<Button variant="secondary" onClick={() => update({ show: '', owner: '' })}>Show every project</Button>}
        />
      ) : phone ? (
        <PhoneList projects={shown} today={today} />
      ) : (
        <div className="card overflow-hidden">
          <TimelineChart
            range={{ from: data.from, to: data.to, weeks: data.weeks }}
            today={today}
            currentWeek={data.currentWeek}
            projects={shown}
            busy={busy}
            scale={scale}
            open={openKey}
            onOpen={openDetail}
            details={
              detail && detailProject ? (
                <TimelineDetails detail={detail} project={detailProject} today={today} timeZone={timeZone} trigger={trigger} onClose={() => setDetail(null)} />
              ) : null
            }
          />
          <Legend labels={scale.labels} />
        </div>
      )}
    </div>
  );
}
