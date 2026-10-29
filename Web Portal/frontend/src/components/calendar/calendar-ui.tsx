import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDismiss } from '../../lib/useDismiss';
import type { Priority } from '../../api/tasks';
import type { CalItem, CalStatus } from '../../lib/calendar-model';
import type { CalMeeting } from '../../lib/calendar-meetings';

/**
 * 'Sat 10 Oct' for a 'YYYY-MM-DD' day (formatted as that day, whatever the device's zone): the
 * parts asked for, always in the order weekday, day, month, year, with three-letter months.
 */
export function dayLabel(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const parts = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).formatToParts(new Date(`${key}T12:00:00.000Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return ['weekday', 'day', 'month', 'year'].map(part).filter(Boolean).join(' ');
}

/** 'Thu 15 Oct 2026' (the same words as dayLabel, with the year). */
export function fullDayLabel(key: string): string {
  return `${dayLabel(key)} ${key.slice(0, 4)}`;
}

/** True while the screen matches the media query (false where the browser can't tell). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

function Svg({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      {children}
    </svg>
  );
}

/** Each status: words, an icon and colours — never colour alone. Red is for overdue only. */
export const STATUS_META: Record<CalStatus, { label: string; icon: ReactNode; chip: string; dot: string }> = {
  overdue: {
    label: 'Overdue',
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></Svg>,
    chip: 'border-danger/45 bg-danger-soft text-danger',
    dot: 'bg-danger',
  },
  blocked: {
    label: 'Blocked',
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></Svg>,
    chip: 'border-warning/55 bg-warning-soft text-ink [&_svg]:text-warning',
    dot: 'bg-warning',
  },
  'in-progress': {
    label: 'In progress',
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></Svg>,
    chip: 'border-info/40 bg-info-soft text-ink [&_svg]:text-info',
    dot: 'bg-info',
  },
  todo: {
    label: 'To do',
    icon: <Svg><circle cx="12" cy="12" r="9" /></Svg>,
    chip: 'border-line bg-surface text-ink [&_svg]:text-ink-2',
    dot: 'bg-ink-3',
  },
  done: {
    label: 'Done',
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></Svg>,
    chip: 'border-success/35 bg-success-soft/60 text-ink-2 [&_svg]:text-success',
    dot: 'bg-success',
  },
  projected: {
    label: 'Repeats (not created yet)',
    icon: <Svg><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></Svg>,
    chip: 'border-dashed border-ink-3/60 bg-transparent text-ink-2 [&_svg]:text-ink-2',
    dot: 'border border-dashed border-ink-2 bg-transparent',
  },
};

export const PRIORITY_LABEL: Record<Priority, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };

const MEETING_ICON = <Svg><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 4.5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" /></Svg>;
const MEETING_CHIP = 'border-brand/35 bg-brand/[0.07] text-ink [&_svg]:text-brand';

/**
 * The legend — what each status looks like, and which time zone the dates are in — behind a small
 * button, so it doesn't take a row of the screen. Escape or a click elsewhere closes it.
 */
export function LegendButton({ timeNote }: { timeNote: string }) {
  const order: CalStatus[] = ['overdue', 'todo', 'in-progress', 'blocked', 'done', 'projected'];
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), rootRef, buttonRef);
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="calendar-legend"
        title={timeNote}
        className={`inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl border bg-surface px-2.5 text-sm font-semibold transition-colors hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 ${open ? 'border-brand text-brand' : 'border-line text-ink-2'}`}
      >
        <Svg size={16}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5h.01" /></Svg>
        <span className="max-xl:sr-only">Legend</span>
      </button>
      {open ? (
        <div id="calendar-legend" className="absolute end-0 top-full z-30 mt-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-lift animate-scale-in">
          <ul aria-label="Legend" className="flex flex-col gap-1.5">
            {order.map((s) => (
              <li key={s} className={`flex items-center gap-1.5 rounded-md border border-s-[3px] px-2 py-1 text-xs font-medium ${STATUS_META[s].chip}`}>
                {STATUS_META[s].icon}
                <span>{STATUS_META[s].label}</span>
              </li>
            ))}
            <li className={`flex items-center gap-1.5 rounded-md border border-s-[3px] px-2 py-1 text-xs font-medium ${MEETING_CHIP}`}>
              {MEETING_ICON}
              <span>Meeting</span>
            </li>
          </ul>
          <p className="mt-2.5 text-[11px] leading-snug text-ink-2">The coloured edge is the project’s colour.</p>
          <p className="mt-1 border-t border-line pt-2 text-xs text-ink-2">{timeNote}</p>
        </div>
      ) : null}
    </div>
  );
}

/** The words a screen reader hears for a meeting on the calendar. */
export function meetingName(m: CalMeeting): string {
  return [m.title, `meeting, ${m.time}`, m.cancelled ? 'cancelled' : null, m.recurring ? 'repeats' : null].filter(Boolean).join(', ');
}

/** A meeting on the calendar: its start time and title, the project's colour on its edge. Opens the meeting. */
export function MeetingChip({ meeting: m, color, meta, lines = 1 }: { meeting: CalMeeting; color?: string; meta?: ReactNode; lines?: 1 | 2 }) {
  return (
    <Link
      to={`/meetings/${m.id}`}
      data-item={m.key}
      aria-label={meetingName(m)}
      title={`${m.time} · ${m.title}`}
      style={color ? { borderInlineStartColor: color } : undefined}
      className={`flex w-full min-w-0 items-start gap-1.5 rounded-md border border-s-[3px] px-1.5 text-start text-xs transition-colors hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${lines === 1 && !meta ? 'py-[3px] leading-4 [@media(pointer:coarse)]:py-[5px]' : 'py-1 leading-snug'} ${MEETING_CHIP} ${m.cancelled ? 'opacity-70' : ''}`}
    >
      <span className="mt-px">{MEETING_ICON}</span>
      <span className="min-w-0 flex-1">
        <span className={`font-medium ${lines === 1 ? 'block truncate' : 'line-clamp-2 [overflow-wrap:anywhere]'} ${m.cancelled ? 'line-through' : ''}`}>
          <span className="tabular-nums text-ink-2">{m.time.split(' – ')[0]}</span> <bdi>{m.title}</bdi>
        </span>
        {meta ? <span className="mt-0.5 block truncate text-[11px] font-normal text-ink-2">{meta}</span> : null}
      </span>
      {m.recurring ? <span className="mt-px opacity-70" title="Repeats">{STATUS_META.projected.icon}</span> : null}
    </Link>
  );
}

/** The words a screen reader hears for a task on the calendar. */
export function itemName(item: CalItem): string {
  const t = item.task;
  const parts = [t.title];
  if (item.kind === 'projected') parts.push(`repeat, not created yet, ${dayLabel(item.date)}`);
  else parts.push(STATUS_META[item.status].label.toLowerCase());
  if (item.kind === 'task' && item.recurring) parts.push('repeats');
  if (t.priority === 'URGENT' || t.priority === 'HIGH') parts.push(`${PRIORITY_LABEL[t.priority].toLowerCase()} priority`);
  return parts.join(', ');
}

/**
 * A task on the calendar: status icon and colours, the project's colour on its edge, and up to two
 * lines of its title (one in the month grid, where the whole title is its tooltip). Click for
 * details; drag to another day when allowed.
 */
export function TaskChip({
  item,
  color,
  draggable,
  onOpen,
  onDragStart,
  onDragEnd,
  lines = 2,
  meta,
}: {
  item: CalItem;
  color?: string;
  draggable: boolean;
  onOpen: (item: CalItem) => void;
  onDragStart?: (item: CalItem) => void;
  onDragEnd?: () => void;
  lines?: 1 | 2;
  /** Extra line under the title (week and agenda views): key, project, people. */
  meta?: ReactNode;
}) {
  const s = STATUS_META[item.status];
  return (
    <button
      type="button"
      data-item={item.key}
      draggable={draggable || undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(item);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(item)}
      aria-label={itemName(item)}
      title={`${item.task.key} · ${item.task.title}`}
      style={color ? { borderInlineStartColor: color } : undefined}
      className={`group/chip flex w-full min-w-0 items-start gap-1.5 rounded-md border border-s-[3px] px-1.5 text-start text-xs transition-colors hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${lines === 1 && !meta ? 'py-[3px] leading-4 [@media(pointer:coarse)]:py-[5px]' : 'py-1 leading-snug'} ${s.chip} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <span className="mt-px">{s.icon}</span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className={`font-medium ${lines === 1 ? 'block truncate' : 'line-clamp-2 [overflow-wrap:anywhere]'}`}>{item.task.title}</span>
        {meta ? <span className="mt-0.5 block truncate text-[11px] font-normal">{meta}</span> : null}
      </span>
      {item.kind === 'task' && item.recurring ? (
        <span className="mt-px opacity-70" title="Repeats">{STATUS_META.projected.icon}</span>
      ) : null}
    </button>
  );
}
