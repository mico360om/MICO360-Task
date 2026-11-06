import type { ReactNode } from 'react';
import { shiftMonth } from '../../lib/board-month';
import { MONTH_NAMES, monthTitle, yearChoices } from '../../lib/month-view';
import { TOUCH_TALL } from '../../lib/touch';
import type { BoardPeriod } from './useBoardPeriod';

/** Day | Month, for the board's ViewSwitch (month view). */
export const PERIODS: { value: BoardPeriod; label: string; icon: ReactNode }[] = [
  {
    value: 'day',
    label: 'Day',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
        <rect x="10" y="12.5" width="4" height="4" rx="0.8" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    value: 'month',
    label: 'Month',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01M16.5 17h.01" />
      </>
    ),
  },
];

const ARROW = 'grid h-8 w-8 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
const SELECT =
  'rounded-lg border-0 bg-transparent px-1 text-sm font-semibold text-ink outline-none transition-colors hover:bg-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand [@media(pointer:coarse)]:h-11 [&>option]:bg-surface [&>option]:font-normal [&>option]:text-ink';

/**
 * The month view's bar: previous month, the month and the year, next month, and "This month" when
 * another month is shown. Then, when some tasks have no dates, "No date (12)": a switch that adds them.
 * The months are the company's (the board passes this month in its time zone).
 */
export function MonthBar({
  month,
  thisMonth,
  onChange,
  undated,
  showUndated,
  onShowUndated,
}: {
  month: string;
  thisMonth: string;
  onChange: (month: string) => void;
  /** How many of the board's open tasks have no dates. */
  undated: number;
  showUndated: boolean;
  onShowUndated: (show: boolean) => void;
}) {
  const [year, mm] = month.split('-') as [string, string];
  return (
    <>
      <div role="group" aria-label={`Month: ${monthTitle(month)}`} className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5 [@media(pointer:coarse)]:p-0">
        <button type="button" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month" title="Previous month" className={ARROW}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <select aria-label="Month" value={mm} onChange={(e) => onChange(`${year}-${e.target.value}`)} className={SELECT}>
          {MONTH_NAMES.map((name, i) => {
            const value = String(i + 1).padStart(2, '0');
            return <option key={value} value={value}>{name}</option>;
          })}
        </select>
        <select aria-label="Year" value={Number(year)} onChange={(e) => onChange(`${e.target.value}-${mm}`)} className={`${SELECT} tabular-nums`}>
          {yearChoices(month, thisMonth).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button type="button" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month" title="Next month" className={ARROW}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
      {month !== thisMonth ? (
        <button
          type="button"
          onClick={() => onChange(thisMonth)}
          className={`rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-brand/30 hover:bg-ground ${TOUCH_TALL}`}
        >
          This month
        </button>
      ) : null}
      {undated > 0 || showUndated ? (
        <button
          type="button"
          aria-pressed={showUndated}
          onClick={() => onShowUndated(!showUndated)}
          title={showUndated ? 'Hide the tasks without dates' : 'Show the tasks without dates too'}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${TOUCH_TALL} ${
            showUndated ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30 hover:text-ink'
          }`}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {showUndated ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
          </svg>
          No date ({undated})
        </button>
      ) : null}
    </>
  );
}
