import type { ReactNode } from 'react';
import { FOCUSES, FOCUS_LABELS, type MeetingFocus, type MeetingSummary } from '../../lib/meeting-list';
import { TOUCH_TALL } from '../../lib/touch';
import { Icon } from './kit';

const LIST = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11" />
    <circle cx="5" cy="18" r="1.4" />
  </svg>
);
const MINUTES = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

/** Two a row on a phone, all four in one row from a tablet up (the page's loading placeholder uses it too). */
export const STRIP_GRID = 'mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4';

/** Each number's picture and colour (the colour only when there is something to see). */
const LOOK: Record<MeetingFocus, { icon: ReactNode; bubble: string }> = {
  week: { icon: Icon.calendar, bubble: 'bg-brand/10 text-brand' },
  actions: { icon: LIST, bubble: 'bg-warning-soft text-warning' },
  minutes: { icon: MINUTES, bubble: 'bg-info-soft text-info' },
  held: { icon: Icon.checkCircle, bubble: 'bg-success-soft text-success' },
};

/**
 * Four numbers over the meetings list — still to come in the next 7 days, open action items, minutes
 * to finish, held this month — counted from the list the page already has. Pressing one shows just
 * those meetings (and pressing it again, everything); a 0 is plain text, as there is nothing to show.
 */
export function MeetingSummaryStrip({
  summary,
  focus,
  onFocus,
}: {
  summary: MeetingSummary;
  focus: MeetingFocus | undefined;
  onFocus: (focus: MeetingFocus | undefined) => void;
}) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const hint: Partial<Record<MeetingFocus, string>> = {
    actions: summary.actions ? `in ${plural(summary.actionMeetings, 'meeting', 'meetings')}` : undefined,
  };
  return (
    <div role="group" aria-label="Meetings at a glance" className={STRIP_GRID}>
      {FOCUSES.map((key) => {
        const value = summary[key];
        const pressed = focus === key;
        // Phones and tablets: one line each ("2 Minutes to finish"), so the four take one or two short
        // rows. A laptop and up: the number on top (with its hint beside it, so every tile is the same
        // height), its name under it and, with room, the picture at the end — like the dashboard's tiles.
        const body = (
          <>
            <span className="flex min-w-0 items-baseline gap-2 lg:block">
              <span className="flex items-baseline gap-2">
                <span className="font-display text-lg font-bold leading-none tabular-nums text-ink lg:text-2xl">{value}</span>
                {hint[key] ? <span className="hidden whitespace-nowrap text-xs text-ink-3 lg:inline">{hint[key]}</span> : null}
              </span>
              <span className="block min-w-0 text-xs font-medium leading-snug text-ink-2 lg:mt-1.5">{FOCUS_LABELS[key]}</span>
            </span>
            <span aria-hidden="true" className={`hidden h-9 w-9 flex-none place-items-center rounded-xl xl:grid ${value ? LOOK[key].bubble : 'bg-ground text-ink-3'}`}>{LOOK[key].icon}</span>
          </>
        );
        const frame = 'flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-start lg:items-start lg:px-4 lg:py-3';
        if (!value) {
          return (
            <div key={key} data-summary-tile className={`${frame} border-line bg-surface`}>
              {body}
            </div>
          );
        }
        return (
          <button
            key={key}
            type="button"
            data-summary-tile
            aria-pressed={pressed}
            title={pressed ? 'Show all meetings' : key === 'actions' ? 'Show the meetings with open action items' : `Show these meetings`}
            onClick={() => onFocus(pressed ? undefined : key)}
            className={`${frame} ${TOUCH_TALL} shadow-soft transition-[border-color,background-color,box-shadow] ${
              pressed ? 'border-brand/60 bg-brand/[0.07] ring-1 ring-brand/30' : 'border-line bg-surface hover:border-brand/35 hover:shadow-lift'
            }`}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
