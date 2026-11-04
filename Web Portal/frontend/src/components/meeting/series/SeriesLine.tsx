import type React from 'react';
import { Link } from 'react-router-dom';
import type { MeetingSeriesContext, SeriesNeighbour } from '../../../api/meeting-series';
import { seriesDay, seriesHref } from '../../../lib/meeting-series';
import { TOUCH_TALL } from '../../../lib/touch';

const SERIES_ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="7" height="7" rx="1.5" />
    <rect x="14" y="4" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 17.5h7M17.5 14v7" />
  </svg>
);
export const SeriesIcon = () => SERIES_ICON;

const linkClass = `tap inline-flex items-center gap-1 rounded font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${TOUCH_TALL}`;

function Neighbour({ which, to, timeZone, now }: { which: 'previous' | 'next'; to: SeriesNeighbour; timeZone: string; now: Date }) {
  const day = seriesDay(to.startAt, timeZone, now);
  const word = which === 'previous' ? 'Previous' : 'Next';
  return (
    <Link to={`/meetings/${encodeURIComponent(to.id)}`} className={linkClass} aria-label={`${word} (${day}): ${to.title}`} title={to.title}>
      {which === 'previous' ? <span aria-hidden="true" className="rtl:rotate-180">‹</span> : null}
      <span>
        {word} <span className="font-normal text-ink-2">({day})</span>
      </span>{' '}
      {which === 'next' ? <span aria-hidden="true" className="rtl:rotate-180">›</span> : null}
    </Link>
  );
}

/**
 * Under the meeting's title: "Series: Monthly OXY review · 3 of 5 · ‹ Previous (3 Nov) · Next (3 Dec) ›"
 * — counted over the meetings this person may open; with only this one, just the series' name.
 */
export function SeriesLine({ context, timeZone, now = new Date() }: { context: MeetingSeriesContext; timeZone: string; now?: Date }) {
  const { series, position, total, previous, next } = context;
  // Each part carries its "·" in front, so a part that wraps takes its dot with it (none left at a line's
  // end); real spaces between, so the line reads and copies as words (a flex row draws the gaps).
  const part = (key: string, content: React.ReactNode) => (
    <span key={key} className="inline-flex items-center gap-x-2">
      <span aria-hidden="true" className="text-ink-3">·</span>{' '}
      {content}
    </span>
  );
  return (
    <nav aria-label="Meeting series" className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="flex-none text-ink-3">{SERIES_ICON}</span>
        <span>Series:</span>{' '}
        <Link to={seriesHref(series.id)} className={`${linkClass} min-w-0 font-semibold`}>
          <bdi className="truncate">{series.name}</bdi>
        </Link>
      </span>{' '}
      {position !== null && total > 1 ? part('position', <span className="tabular-nums">{position} of {total}</span>) : null}{' '}
      {previous ? part('previous', <Neighbour which="previous" to={previous} timeZone={timeZone} now={now} />) : null}{' '}
      {next ? part('next', <Neighbour which="next" to={next} timeZone={timeZone} now={now} />) : null}
    </nav>
  );
}
