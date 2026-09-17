import { useCompanyClock } from '../lib/company-clock';

/**
 * Live system date & time in the company time zone (single source of truth),
 * shown in the top bar before the search field. Responsive: the date collapses
 * on very small screens, leaving the time always visible.
 */
export function SystemClock() {
  const { date, time, timeZone } = useCompanyClock();

  return (
    <div
      className="flex flex-none items-center gap-1.5 rounded-lg border border-line bg-surface/60 px-2.5 py-1.5 text-ink-2"
      title={`Company time — ${timeZone}`}
      aria-label={`Company date and time: ${date} ${time}`}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-brand">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 1.8" />
      </svg>
      <span className="hidden text-[13px] font-medium text-ink lg:inline">{date}</span>
      <span className="hidden text-line lg:inline" aria-hidden="true">|</span>
      <span className="text-[13px] font-semibold text-ink tabular-nums">{time}</span>
    </div>
  );
}
