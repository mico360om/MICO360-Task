import { useId, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { activityApi, type ActivityKind, type ApiActivity } from '../../api/activity';
import { useAuthStore } from '../../stores/auth-store';
import { readUserValue, writeUserValue } from '../../lib/user-storage';
import { useDateSettings } from '../../lib/useDatePrefs';
import { todayKey } from '../../lib/due-date';
import { dayText } from '../../lib/day-words';
import { weekdayLabels } from '../../lib/calendar';
import { ACTIVITY_PERIOD_PREF, calendarPeriod, changesText, periodText, shadeStep, stepCursor, type ActivityCalendarMode } from '../../lib/activity-calendar';
import { Button } from '../ui/Button';
import { LoadError } from '../ui/LoadError';

const MODES: { value: ActivityCalendarMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
];

/** A day's look by how busy it was: none, then four steps of the brand colour (the busiest in white on it). */
const SHADE = ['bg-surface', 'bg-brand/15', 'bg-brand/30', 'bg-brand/50', 'bg-brand/80 text-white'] as const;

const fullDay = (key: string) => dayText(key, { weekday: 'long', month: 'long' });

/**
 * The Activity calendar (1.22): a month or a week, each day with its number of changes, shaded from
 * quiet to busy; click a day for its changes under it. The page's filter and the company picked in
 * the top bar apply to both (the server counts and lists with the feed's own rules). Days are the
 * site's; the week starts on the person's own week start, else the company's.
 */
export function ActivityCalendar({
  kind,
  kindLabel,
  renderRow,
}: {
  kind: ActivityKind | '';
  kindLabel?: string;
  /** One of the day's changes, as the list shows it (with the time of day in the site's zone). */
  renderRow: (a: ApiActivity, timeZone: string) => ReactNode;
}) {
  const userId = useAuthStore((s) => s.user?.id);
  const { companyTimeZone: timeZone, weekStart } = useDateSettings();
  const today = todayKey(timeZone);
  const [mode, setModeState] = useState<ActivityCalendarMode>(() => (readUserValue(useAuthStore.getState().user?.id, ACTIVITY_PERIOD_PREF) === 'week' ? 'week' : 'month'));
  // null = today (it moves on at midnight with the page left open).
  const [cursor, setCursor] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const at = cursor ?? today;
  const day = picked ?? today;
  const period = useMemo(() => calendarPeriod(mode, at, weekStart), [mode, at, weekStart]);
  const setMode = (next: ActivityCalendarMode) => {
    // Into a week: the week of the day picked, when it's in the month shown (else the month's own).
    if (next === 'week' && mode === 'month' && day >= period.from && day <= period.to) setCursor(day === today ? null : day);
    setModeState(next);
    writeUserValue(userId, ACTIVITY_PERIOD_PREF, next);
  };

  const countsQ = useQuery({
    queryKey: ['activity', 'days', period.from, period.to, kind],
    queryFn: () => activityApi(apiClient).days(period.from, period.to, kind),
    placeholderData: keepPreviousData,
  });
  const counts = useMemo(() => new Map((Array.isArray(countsQ.data) ? countsQ.data : []).map((c) => [c.day, c.count])), [countsQ.data]);
  const max = Math.max(0, ...counts.values());

  const dayQ = useInfiniteQuery({
    queryKey: ['activity', 'day', day, kind],
    queryFn: ({ pageParam }) => activityApi(apiClient).day(day, { kind, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows = (dayQ.data?.pages ?? []).flatMap((p) => (Array.isArray(p.data) ? p.data : []));

  const unit = mode === 'week' ? 'week' : 'month';
  const label = periodText(mode, at, weekStart);
  const headingId = useId();
  const dayHeadingId = useId();
  const pick = (key: string) => setPicked(key === today ? null : key);
  const dayCount = counts.get(day);

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby={headingId} className="card p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5 [@media(pointer:coarse)]:p-0">
            <button
              type="button"
              onClick={() => setCursor(stepCursor(mode, at, -1))}
              aria-label={`Previous ${unit}`}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button
              type="button"
              onClick={() => { setCursor(null); setPicked(null); }}
              className="h-8 rounded-lg px-2.5 text-sm font-medium text-ink transition-colors hover:bg-ground [@media(pointer:coarse)]:h-11"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setCursor(stepCursor(mode, at, 1))}
              aria-label={`Next ${unit}`}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
          <h2 id={headingId} className="min-w-0 font-display text-base font-bold text-ink">{label}</h2>
          <div role="group" aria-label="Calendar period" className="ms-auto inline-flex rounded-xl border border-line bg-surface p-0.5">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={mode === m.value}
                onClick={() => setMode(m.value)}
                className={`h-8 rounded-lg px-3 text-sm font-medium transition-colors [@media(pointer:coarse)]:h-11 ${mode === m.value ? 'bg-brand text-white' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {countsQ.isError && !countsQ.data ? (
          <LoadError what="the calendar" onRetry={() => void countsQ.refetch()} />
        ) : (
          <div aria-busy={countsQ.isFetching || undefined} className={`transition-opacity ${countsQ.isPlaceholderData ? 'opacity-60' : ''}`}>
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-2" aria-hidden="true">
              {weekdayLabels(weekStart).map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="flex flex-col gap-1">
              {period.weeks.map((week) => (
                <div key={week[0]!.key} className="grid grid-cols-7 gap-1">
                  {week.map((cell) => {
                    const n = counts.get(cell.key) ?? 0;
                    const step = countsQ.data ? shadeStep(n, max) : 0;
                    const isToday = cell.key === today;
                    const chosen = cell.key === day;
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        data-day={cell.key}
                        data-shade={step}
                        aria-pressed={chosen}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={`${fullDay(cell.key)}: ${countsQ.data ? changesText(n) : 'loading'}${isToday ? ', today' : ''}`}
                        onClick={() => pick(cell.key)}
                        className={`relative flex !min-h-[2.75rem] flex-col items-center justify-between rounded-lg border px-1 py-1 text-center transition-colors sm:!min-h-[4.25rem] sm:items-stretch sm:p-1.5 ${SHADE[step]} ${
                          chosen ? 'border-brand ring-2 ring-brand/40' : 'border-line hover:border-brand/40'
                        } ${cell.inMonth ? '' : 'opacity-60'}`}
                      >
                        <span
                          className={`text-[11px] font-semibold leading-none sm:self-start ${isToday ? 'rounded-full bg-brand px-1.5 py-0.5 text-white' : step === 4 ? 'text-white' : cell.inMonth ? 'text-ink-2' : 'text-ink-3'}`}
                        >
                          {cell.day}
                        </span>
                        <span className={`text-sm font-bold tabular-nums sm:text-lg ${step === 4 ? 'text-white' : n ? 'text-ink' : 'text-ink-3'}`}>{countsQ.data ? (n || '–') : ''}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-ink-2">
              <span>Quiet</span>
              {SHADE.slice(1).map((s) => <span key={s} aria-hidden="true" className={`inline-block h-3 w-3 rounded-sm border border-line ${s}`} />)}
              <span>Busy</span>
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby={dayHeadingId}>
        <h2 id={dayHeadingId} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">
          {fullDay(day)}
          {dayCount !== undefined || countsQ.data ? <span className="font-normal normal-case tracking-normal"> · {changesText(dayCount ?? 0)}</span> : null}
        </h2>
        {dayQ.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
          </div>
        ) : dayQ.isError && rows.length === 0 ? (
          <LoadError what="this day’s changes" onRetry={() => void dayQ.refetch()} />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-sm text-ink-2">
            {kind && kindLabel ? `No ${kindLabel.toLowerCase()} changes on this day.` : 'No changes on this day.'}
          </p>
        ) : (
          <>
            <ol className="ml-2 flex flex-col gap-1.5 border-l border-line pl-5">
              {rows.map((a) => renderRow(a, timeZone))}
            </ol>
            {dayQ.hasNextPage ? (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => void dayQ.fetchNextPage()} disabled={dayQ.isFetchingNextPage} className="[@media(pointer:coarse)]:!min-h-11">
                  {dayQ.isFetchingNextPage ? 'Loading…' : 'Show more'}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
