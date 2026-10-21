import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { meetingsApi, type FreeTimesReply, type RecurrenceRule } from '../../api/meetings';
import { formatMeetingDay, formatMeetingRange, formatMeetingTimes, fromLocalInputValue, toLocalInputValue } from '../../lib/meetingFormat';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface FreeTimesProps {
  /** The invited portal users, the organizer included (guests have no known calendar). */
  userIds: string[];
  /** The chosen start (ISO), or null while it isn't valid. */
  startAt: string | null;
  minutes: number;
  rule: RecurrenceRule | null;
  /** The meeting being edited: its own time isn't a clash. */
  excludeMeetingId?: string;
  onPick: (startAt: string) => void;
}

/**
 * Free times, worked out by the server without AI: three suggested times when everyone invited is
 * free (inside the company's meeting hours), who clashes with the chosen time, and the chosen day's
 * busy blocks per person (a meeting the person scheduling can't see shows as "Busy").
 */
export function FreeTimes({ userIds, startAt, minutes, rule, excludeMeetingId, onPick }: FreeTimesProps) {
  const timeZone = useCompanyTimeZone();
  // Checked again once the time, length, repeat or people have settled for 400 ms.
  const key = useDebounced(JSON.stringify({ userIds: [...new Set(userIds)], startAt, minutes: Math.min(720, Math.max(5, Math.round(minutes))), rule, excludeMeetingId }), 400);
  const input = JSON.parse(key) as { userIds: string[]; startAt: string | null; minutes: number; rule: RecurrenceRule | null; excludeMeetingId?: string };
  const q = useQuery({
    queryKey: ['meeting-free-times', key],
    queryFn: () =>
      meetingsApi(apiClient).freeTimes({
        userIds: input.userIds,
        startAt: input.startAt!,
        minutes: input.minutes,
        ...(input.rule ? { recurrenceRule: input.rule } : {}),
        ...(input.excludeMeetingId ? { excludeMeetingId: input.excludeMeetingId } : {}),
      }),
    enabled: !!input.startAt && input.userIds.length > 0,
    staleTime: 30_000,
  });
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Suggestions are for what was chosen when asked: a change hides them until asked again.
  useEffect(() => setShowSuggestions(false), [key]);
  // Read defensively: an older server (or a proxy page) may answer with something else.
  const data: FreeTimesReply | undefined =
    q.data && Array.isArray(q.data.suggestions) && Array.isArray(q.data.clashes) && Array.isArray(q.data.day) && q.data.workingHours ? q.data : undefined;
  const canAsk = !!startAt && userIds.length > 0;

  return (
    <section aria-label="Free times" className="flex flex-col gap-2 rounded-2xl border border-line bg-ground/50 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Free times</p>
        <button
          type="button"
          disabled={!canAsk}
          onClick={() => {
            // Asking (again) checks afresh: someone may have booked a meeting, or the meeting hours changed.
            if (showSuggestions || q.isStale) void q.refetch();
            setShowSuggestions(true);
          }}
          className="min-h-9 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-brand hover:border-brand/40 disabled:opacity-50"
        >
          Suggest 3 times
        </button>
      </div>
      {showSuggestions ? (
        q.isError || (q.isSuccess && !data) ? (
          <p role="alert" className="text-sm text-danger">Couldn’t check free times. Please try again.</p>
        ) : !data ? (
          <p className="text-sm text-ink-2">Finding free times…</p>
        ) : data.suggestions.length ? (
          <div role="group" aria-label="Suggested times" className="flex flex-wrap gap-1.5">
            {data.suggestions.map((s) => (
              <button key={s} type="button" onClick={() => onPick(s)} className="min-h-9 rounded-lg border border-brand/40 bg-surface px-3 text-sm font-medium text-ink hover:bg-brand/10">
                {formatMeetingRange(s, null, timeZone)}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-2">No free time found in the next two weeks.</p>
        )
      ) : null}
      <div role="status" aria-label="Clashes">
        {data?.clashes.length ? (
          <div className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-ink">
            <p className="font-semibold text-warning">Someone invited already has a meeting then:</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {data.clashes.map((c) => (
                <li key={`${c.userId}-${c.start}`}>
                  <bdi>{c.name}</bdi> — {formatMeetingRange(c.start, c.end, timeZone)} (<bdi>{c.title ?? 'Busy'}</bdi>)
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {data?.day.length && startAt ? <BusyStrip day={data.day} hours={data.workingHours} startAt={startAt} minutes={minutes} timeZone={timeZone} /> : null}
    </section>
  );
}

/** The chosen day, one row per person: their meetings drawn across the working day, and listed. */
function BusyStrip({ day, hours, startAt, minutes, timeZone }: { day: FreeTimesReply['day']; hours: FreeTimesReply['workingHours']; startAt: string; minutes: number; timeZone: string }) {
  const dayKey = toLocalInputValue(startAt, timeZone).slice(0, 10);
  const from = Date.parse(fromLocalInputValue(`${dayKey}T${hours.start}`, timeZone) ?? startAt);
  const to = Date.parse(fromLocalInputValue(`${dayKey}T${hours.end}`, timeZone) ?? startAt);
  const span = Math.max(1, to - from);
  const place = (start: string, end: string) => {
    const left = Math.min(1, Math.max(0, (Date.parse(start) - from) / span));
    const right = Math.min(1, Math.max(0, (Date.parse(end) - from) / span));
    return { left: `${left * 100}%`, width: `${Math.max(0.01, right - left) * 100}%` };
  };
  const chosenEnd = new Date(Date.parse(startAt) + minutes * 60_000).toISOString();
  const label = `Busy on ${formatMeetingDay(startAt, timeZone)}`;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-ink-2">
        {label} <span className="text-ink-3">({hours.start}–{hours.end})</span>
      </p>
      <ul aria-label={label} className="flex flex-col gap-1.5">
        {day.map((p) => (
          <li key={p.userId} className="grid grid-cols-1 gap-1 sm:grid-cols-[8rem_1fr] sm:items-center">
            <bdi className="truncate text-xs font-semibold text-ink">{p.name}</bdi>
            <div className="flex flex-col gap-0.5">
              <div aria-hidden="true" className="relative h-3 overflow-hidden rounded-full bg-surface ring-1 ring-line">
                {p.blocks.map((b) => (
                  <span key={b.start} className={`absolute inset-y-0 rounded-full ${b.title ? 'bg-brand/60' : 'bg-ink-3/50'}`} style={place(b.start, b.end)} />
                ))}
                <span className="absolute inset-y-0 rounded-full border-2 border-warning" style={place(startAt, chosenEnd)} />
              </div>
              <p className="text-xs text-ink-2">
                {p.blocks.length
                  ? p.blocks.map((b, i) => (
                      <span key={b.start}>
                        {i ? '; ' : ''}
                        {formatMeetingTimes(b.start, b.end, timeZone)} <bdi>{b.title ?? 'Busy'}</bdi>
                      </span>
                    ))
                  : 'No meetings'}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
