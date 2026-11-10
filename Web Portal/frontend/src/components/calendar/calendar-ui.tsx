import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDismiss } from '../../lib/useDismiss';
import type { Priority } from '../../api/tasks';
import type { CalItem, CalStatus } from '../../lib/calendar-model';
import type { CalMeeting } from '../../lib/calendar-meetings';
import type { CalendarChecklistItem } from '../../lib/calendar-checklist';
import { WaitingIcon } from '../approvals/ApprovalChip';
import { isWaitingForApproval } from '../../lib/approvals';
import { TaskKey } from '../TaskKey';
import { statusClass } from '../../lib/colour-classes';

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

/**
 * Each status: words, an icon and colours — never colour alone. 1.23.8 one colour scheme: the chip's edge is
 * its project's colour and a small dot is its status's (its column kind, lib/colour-classes); overdue is the
 * one red chip (red words and edges); the rest are plain cards, their icon in their status's colour.
 */
export const STATUS_META: Record<CalStatus, { label: string; icon: ReactNode; chip: string; dot: string }> = {
  overdue: {
    label: 'Overdue',
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></Svg>,
    // The scheme's classes written out (lib/colour-classes): the Android app's drift test loads this file on its own.
    chip: 'border-overdue/60 bg-overdue-soft text-overdue',
    dot: 'bg-overdue',
  },
  blocked: {
    label: 'Blocked',
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></Svg>,
    chip: 'border-line bg-surface text-ink [&_svg]:text-status-blocked',
    dot: 'bg-status-blocked',
  },
  'in-progress': {
    label: 'In progress',
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></Svg>,
    chip: 'border-line bg-surface text-ink [&_svg]:text-status-progress',
    dot: 'bg-status-progress',
  },
  todo: {
    label: 'To do',
    icon: <Svg><circle cx="12" cy="12" r="9" /></Svg>,
    chip: 'border-line bg-surface text-ink [&_svg]:text-ink-2',
    dot: 'bg-status-todo',
  },
  done: {
    label: 'Done',
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></Svg>,
    chip: 'border-line bg-surface/60 text-ink-2 [&_svg]:text-status-done',
    dot: 'bg-status-done',
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
        className={`inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl border bg-surface px-2.5 text-sm font-semibold transition-colors hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:!min-w-11 ${open ? 'border-brand text-brand' : 'border-line text-ink-2'}`}
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
            <li className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink">
              <span className="text-warning">
                <WaitingIcon size={14} />
              </span>
              <span>Waiting for approval</span>
            </li>
          </ul>
          <p className="mt-2.5 text-[11px] leading-snug text-ink-2">The coloured edge is the project’s colour; the small dot is the task’s status.</p>
          <p className="mt-1 border-t border-line pt-2 text-xs text-ink-2">{timeNote}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 1.23.8 A task's status as a small dot in its column kind's colour (lib/colour-classes) — a repeat not
 * created yet has a hollow one. Its words are in the chip's name.
 */
function StatusDot({ item, className = '' }: { item: CalItem; className?: string }) {
  if (item.kind === 'projected') return <span data-status-dot aria-hidden="true" className={`inline-block h-1.5 w-1.5 flex-none rounded-full border border-dashed border-ink-2 ${className}`} />;
  return <span data-status-dot aria-hidden="true" className={`inline-block h-1.5 w-1.5 flex-none rounded-full ${statusClass(item.task.columnCategory).dot} ${className}`} />;
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

/** A task finished but waiting for approval (never a projected copy, never a done one). */
const waits = (item: CalItem) => item.kind === 'task' && item.status !== 'done' && isWaitingForApproval(item.task);

/** The words a screen reader hears for a task on the calendar: its number first (1.22.3), as the chip shows it. */
export function itemName(item: CalItem): string {
  const t = item.task;
  // A repeat not created yet has no number of its own (the series' is another task's).
  const parts = [item.kind === 'task' && t.key ? `${t.key} ${t.title}` : t.title];
  if (item.kind === 'projected') parts.push(`repeat, not created yet, ${dayLabel(item.date)}`);
  else parts.push(STATUS_META[item.status].label.toLowerCase());
  if (item.kind === 'task' && item.recurring) parts.push('repeats');
  if (waits(item)) parts.push('waiting for approval');
  if (t.priority === 'URGENT' || t.priority === 'HIGH') parts.push(`${PRIORITY_LABEL[t.priority].toLowerCase()} priority`);
  return parts.join(', ');
}

/**
 * A task on the calendar: status icon and colours, the project's colour on its edge, its number (the
 * TaskKey chip, 1.22.3) and up to two lines of its title (one in the month grid, where the title
 * truncates and never the number, and the whole title is its tooltip). Click for details; drag to
 * another day when allowed. A repeat not created yet shows no number: it has none yet.
 *
 * 1.22.3 review: in the month grid the chip is drawn only from 2xl (1536 px), where a day is wide
 * enough; at 1024–1440 px a day is 100–140 px and the chip left the title a few letters, a long code
 * (TN2FF00336-2) cut off. Narrower, the number is in the chip's name and tooltip only.
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
  const number = item.kind === 'task' ? item.task.key : null;
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
        {lines === 1 ? (
          <span className="flex min-w-0 items-center gap-1">
            {/* 1.23.8: its status's dot (its column kind) — the edge stays its project's colour. */}
            <StatusDot item={item} />
            {number ? <TaskKey value={number} dense className="hidden 2xl:inline-block" /> : null}
            <span dir="auto" className="block min-w-0 truncate font-medium">{item.task.title}</span>
          </span>
        ) : (
          <span className="line-clamp-2 font-medium [overflow-wrap:anywhere]">
            <StatusDot item={item} className="me-1 align-middle" />
            {number ? <TaskKey value={number} dense className="me-1" /> : null}
            <span dir="auto">{item.task.title}</span>
          </span>
        )}
        {meta ? <span className="mt-0.5 block truncate text-[11px] font-normal">{meta}</span> : null}
      </span>
      {/* Waiting for approval: an hourglass, as on the board (its words are in the chip's name, and on hover). */}
      {waits(item) ? (
        <span data-mark="waiting" className="mt-px flex-none [&_svg]:!text-warning" title="Waiting for approval">
          <WaitingIcon size={13} />
        </span>
      ) : null}
      {item.kind === 'task' && item.recurring ? (
        <span className="mt-px opacity-70" title="Repeats">{STATUS_META.projected.icon}</span>
      ) : null}
    </button>
  );
}

/** The words a screen reader hears for a checklist item on the calendar (1.23.3). */
export function checklistChipName(item: CalendarChecklistItem, late = false): string {
  return `Checklist item “${item.text}” on ${item.taskKey}${item.done ? ', done' : late ? ', overdue' : ''}`;
}

/**
 * A checklist item due on a day (1.23.3): a small chip "☐ Label circuits · MICO-142" (☑ and struck
 * through once done; red words when late). It opens the task at the item. In the month grid the
 * number shows only where a day is wide enough (2xl); its name and tooltip always carry it.
 */
export function ChecklistChip({ item, onOpen, late = false, lines = 2 }: { item: CalendarChecklistItem; onOpen: (item: CalendarChecklistItem) => void; late?: boolean; lines?: 1 | 2 }) {
  return (
    <button
      type="button"
      data-item={`cl:${item.id}`}
      data-testid="calendar-checklist-item"
      onClick={() => onOpen(item)}
      aria-label={checklistChipName(item, late)}
      title={`${item.text} · ${item.taskKey}`}
      className={`flex w-full min-w-0 items-center gap-1 rounded-md border border-dashed px-1.5 text-start text-[11px] leading-4 transition-colors hover:border-brand/60 hover:bg-brand/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand py-[2px] [@media(pointer:coarse)]:py-[5px] ${late ? 'border-danger/45 text-danger' : 'border-line text-ink-2'}`}
    >
      <span aria-hidden="true" className="flex-none text-[12px] leading-none">
        {item.done ? '☑' : '☐'}
      </span>
      <span dir="auto" className={`min-w-0 truncate font-medium ${item.done ? 'text-ink-3 line-through' : ''}`}>
        {item.text}
      </span>
      <span aria-hidden="true" dir="ltr" translate="no" className={`flex-none font-mono text-[10px] text-ink-3 ${lines === 1 ? 'hidden 2xl:inline' : ''}`}>
        · {item.taskKey}
      </span>
    </button>
  );
}
