import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { dayText } from '../../lib/day-words';
import { shiftDayKey } from '../../lib/due-date';
import { monthWeeks, weekdayLabels, type WeekStart } from '../../lib/calendar';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { SearchableSelect } from './SearchableSelect';

const MONTH = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "November 2026" for a 'YYYY-MM'. */
const monthText = (ym: string) => MONTH.format(new Date(`${ym}-01T12:00:00.000Z`));
/** 'YYYY-MM' a number of months from another. */
function shiftMonth(ym: string, by: number): string {
  const d = new Date(`${ym}-01T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}
const pad = (n: number) => String(n).padStart(2, '0');

/** The times offered: every quarter hour of the day on the 24-hour clock ("00:00" … "23:45"), plus `current` when it falls between them. */
export function timeOptions(current: string): Array<{ value: string; label: string }> {
  const times = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
  if (/^\d{2}:\d{2}$/.test(current) && !times.includes(current)) times.push(current);
  return times.sort().map((t) => ({ value: t, label: t }));
}

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-ink-3">
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M8 2.5v4M16 2.5v4M3 10h18" />
  </svg>
);

/**
 * A day picked from a month calendar: a button showing the day as the site writes it ("Wed 4 Nov
 * 2026", or "30 Oct 2026") that opens the calendar beside it — the week starting on the person's (or
 * company's) week start, today marked, the arrow keys moving by day and week, Escape closing it.
 * `clearLabel`: a button in the calendar that picks no day (`null`).
 */
export function DayPickerButton({
  ariaLabel,
  value,
  onPick,
  today,
  weekStart,
  placeholder,
  clearLabel,
  weekday = false,
  className = '',
  children,
  disabled,
}: {
  ariaLabel: string;
  /** 'YYYY-MM-DD', or '' for none. */
  value: string;
  onPick: (day: string | null) => void;
  /** Today in the site's time zone ('YYYY-MM-DD'). */
  today: string;
  weekStart: WeekStart;
  placeholder: string;
  clearLabel?: string;
  /** Write the weekday too ("Wed 4 Nov 2026"). */
  weekday?: boolean;
  className?: string;
  /** Instead of the day in words (a chip's own look). */
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const shown = value ? dayText(value, weekday ? { weekday: 'short' } : {}) : placeholder;
  const close = () => {
    setOpen(false);
    anchor.current?.focus();
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${className} ${TOUCH_TALL}`}
      >
        {children ?? (
          <>
            <CalendarIcon />
            <span className={`truncate ${value ? 'text-ink' : 'text-ink-2'}`}>{shown}</span>
          </>
        )}
      </button>
      {open ? (
        <CalendarPopover anchor={anchor} onClose={() => setOpen(false)}>
          <DayCalendar
            value={value}
            today={today}
            weekStart={weekStart}
            onPick={(day) => {
              onPick(day);
              close();
            }}
            clearLabel={clearLabel}
          />
        </CalendarPopover>
      ) : null}
    </>
  );
}

/** The calendar's box: on top of everything (dialogs too), below its button or above it when there's no room. */
function CalendarPopover({ anchor, onClose, children }: { anchor: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = root.current;
      if (!a || !el) return;
      const [w, h] = [el.offsetWidth, el.offsetHeight];
      const below = a.bottom + 6;
      const above = a.top - 6 - h;
      // Below its button, else above it; with room for neither (a phone), as low as still fits on the screen.
      const fits = below + h <= window.innerHeight - 8;
      const top = fits ? below : above >= 8 ? above : Math.max(8, window.innerHeight - 8 - h);
      setPos({ top, left: Math.max(8, Math.min(a.left, window.innerWidth - w - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the calendar closes (not the dialog it's in).
      e.stopPropagation();
      close.current();
      anchor.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (root.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-label="Choose a day"
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !root.current?.contains(to) && !anchor.current?.contains(to)) close.current();
      }}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, zIndex: 70, visibility: pos ? 'visible' : 'hidden', maxHeight: 'calc(100vh - 1rem)', overflowY: 'auto' }}
      className="w-[min(19rem,calc(100vw-1rem))] rounded-xl border border-line bg-surface p-3 text-sm shadow-lift animate-fade-in"
    >
      {children}
    </div>,
    document.body,
  );
}

/** The month calendar on its own (1.23.4: inside the Dashboard's Reschedule menu, which is a popover itself). */
export function DayCalendar({ value, today, weekStart, onPick, clearLabel }: { value: string; today: string; weekStart: WeekStart; onPick: (day: string | null) => void; clearLabel?: string }) {
  const start = value || today;
  const [focus, setFocus] = useState(start);
  const [month, setMonth] = useState(start.slice(0, 7));
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(false);
  const weeks = monthWeeks(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, weekStart);

  // The focused day keeps the keyboard focus (on opening, and as the arrow keys move it).
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, month]);

  const go = (day: string) => {
    moved.current = true;
    setFocus(day);
    if (day.slice(0, 7) !== month) setMonth(day.slice(0, 7));
  };
  const turn = (by: number) => {
    const next = shiftMonth(month, by);
    setMonth(next);
    // The same day of the other month, as near as it has one.
    const day = Math.min(Number(focus.slice(8, 10)), new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)), 0)).getUTCDate());
    setFocus(`${next}-${pad(day)}`);
  };
  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      go(shiftDayKey(focus, step[e.key]!));
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      turn(e.key === 'PageUp' ? -1 : 1);
    }
  };

  return (
    <div data-month={month}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous month" onClick={() => turn(-1)} className={`grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink ${TOUCH_SQUARE}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <p aria-live="polite" className="font-semibold text-ink">{monthText(month)}</p>
        <button type="button" aria-label="Next month" onClick={() => turn(1)} className={`grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink ${TOUCH_SQUARE}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
      <table ref={grid} onKeyDown={onKey} className="w-full table-fixed border-collapse text-center">
        <thead>
          <tr>
            {weekdayLabels(weekStart).map((d) => (
              <th key={d} scope="col" className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.key}>
              {week.map((c) => {
                const picked = c.key === value;
                const isToday = c.key === today;
                return (
                  <td key={c.key} className="p-0.5">
                    <button
                      type="button"
                      data-day={c.key}
                      tabIndex={c.key === focus ? 0 : -1}
                      aria-label={dayText(c.key, { weekday: 'short' })}
                      aria-pressed={picked}
                      aria-current={isToday ? 'date' : undefined}
                      onClick={() => onPick(c.key)}
                      className={`h-9 w-full rounded-lg text-sm tabular-nums transition-colors [@media(pointer:coarse)]:!min-h-11 ${
                        picked ? 'bg-brand-gradient font-semibold text-white' : c.inMonth ? 'text-ink hover:bg-ground' : 'text-ink-3 hover:bg-ground'
                      } ${isToday && !picked ? 'font-semibold ring-1 ring-inset ring-brand/50' : ''}`}
                    >
                      {c.day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-xs">
        <button type="button" onClick={() => onPick(today)} className={`rounded-md px-2 font-medium text-brand hover:underline ${TOUCH_TALL} min-h-8`}>Today</button>
        {clearLabel ? (
          <button type="button" onClick={() => onPick(null)} className={`rounded-md px-2 font-medium text-ink-2 hover:text-ink hover:underline ${TOUCH_TALL} min-h-8`}>{clearLabel}</button>
        ) : null}
      </div>
    </div>
  );
}

const BOX = 'flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 text-left text-sm outline-none transition-colors hover:border-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20';

/**
 * A day and a time as the site writes them — "Wed 4 Nov 2026" · "13:00", on the 24-hour clock —
 * instead of the browser's own date-time box (which writes "04/11/2026 01:00 AM"). The day comes
 * from a month calendar, the time from a list of quarter hours (filter by typing "13"). The value is
 * the wall time 'YYYY-MM-DDTHH:mm' ('' for none). `fill`: where a missing day or time comes from
 * (an end set from its start); `clearable`: an ✕ leaves it empty.
 */
export function DateTimeField({
  label,
  labelId,
  value,
  onChange,
  today,
  weekStart,
  clearable = false,
  fill,
  describedBy,
}: {
  label: string;
  /** The visible label's id (the group's name). */
  labelId: string;
  value: string;
  onChange: (next: string) => void;
  today: string;
  weekStart: WeekStart;
  clearable?: boolean;
  fill?: string;
  describedBy?: string;
}) {
  const day = value.slice(0, 10);
  const time = value.slice(11, 16);
  const fillDay = fill?.slice(0, 10) || today;
  const fillTime = fill?.slice(11, 16) || '09:00';
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={describedBy} data-value={value} className="flex min-w-0 items-center gap-1.5">
      <DayPickerButton
        ariaLabel={`${label}: day, ${day ? dayText(day, { weekday: 'short' }) : 'not set'}`}
        value={day}
        weekday
        placeholder="Not set"
        today={today}
        weekStart={weekStart}
        onPick={(d) => d && onChange(`${d}T${time || fillTime}`)}
        className={`${BOX} min-w-0 flex-1`}
      />
      <span aria-hidden="true" className="-mx-0.5 text-ink-3">·</span>
      <SearchableSelect
        size="lg"
        className="w-[5.75rem] flex-none"
        ariaLabel={`${label}: time, ${time || 'not set'}`}
        placeholder="--:--"
        options={timeOptions(time)}
        value={time}
        onChange={(t) => onChange(`${day || fillDay}T${t}`)}
        emptyText="No such time"
      />
      {clearable && value ? (
        <button
          type="button"
          aria-label={`Clear ${label}`}
          title={`Clear ${label}`}
          onClick={() => onChange('')}
          className={`grid h-10 w-10 flex-none place-items-center rounded-lg text-ink-3 hover:bg-ground hover:text-ink ${TOUCH_SQUARE} ${TOUCH_TALL}`}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      ) : null}
    </div>
  );
}
