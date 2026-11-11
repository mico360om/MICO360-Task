import type { KeyboardEvent, ReactNode } from 'react';
import type { SpanItem } from '../../lib/calendar-span';
import type { CalBlock, CalReminder } from '../../api/calendar';
import { startDrag, endDrag, type DragPayload } from '../../lib/calendar-dnd';
import { STATUS_META, dayLabel, itemName } from './calendar-ui';
import { TaskKey } from '../TaskKey';
import { statusClass } from '../../lib/colour-classes';
import { WaitingIcon } from '../approvals/ApprovalChip';
import { isWaitingForApproval } from '../../lib/approvals';
import { timeLabel } from '../../lib/calendar-hours';
import { zonedClock } from '../../lib/working-days';

/**
 * Calendar scheduling's marks — never colour alone (owner, 11 Nov): a task's bar from ▶ its start to
 * ⚑ its due day (a red ⚑ when overdue), a work block as a hatched "Planned" block, a reminder as a bell.
 */

export function StartIcon({ size = 10 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" className="flex-none">
      <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
    </svg>
  );
}

export function DueIcon({ size = 11 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" className="flex-none">
      <path d="M2.5 11V1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3 1.8h6.5L8 4l1.5 2.2H3z" fill="currentColor" />
    </svg>
  );
}

export function BellIcon({ size = 12, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
      {muted ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}

export function PeopleIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="flex-none">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 4.5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" />
    </svg>
  );
}

/** The hatch of planned time (a work block): stripes in the brand colour, light in both themes. */
export const HATCH_STYLE = { backgroundImage: 'repeating-linear-gradient(135deg, rgb(var(--c-brand) / 0.13) 0 5px, transparent 5px 10px)' } as const;

/** "Thu 12 Nov" or "Thu 12 Nov – Mon 16 Nov". */
function spanWords(item: SpanItem): string {
  if (item.mode === 'bar' || item.mode === 'markers') return `from ${dayLabel(item.start!)} to ${dayLabel(item.due!)}`;
  if (item.mode === 'start') return `starts ${dayLabel(item.start!)}`;
  return `due ${dayLabel(item.due!)}`;
}

/** The words a screen reader hears for a task's bar or mark: its name (number, title, status…), then where it runs. */
export function barName(item: SpanItem, role: 'bar' | 'start' | 'due' | 'single'): string {
  // A one-day mark sits on its own day: its name needs no date (the day's own button says it).
  if (role === 'single') return itemName(item);
  const where = role === 'start' && item.mode === 'markers' ? `starts ${dayLabel(item.start!)}` : role === 'due' && item.mode === 'markers' ? `due ${dayLabel(item.due!)}` : spanWords(item);
  return `${itemName(item)}, ${where}`;
}

/** Keys that move a focused task, block or meeting (with the same Undo as a drag). */
export type KeyMove = { days: number; minutes: number; edge: 'body' | 'due' | 'end' };
export function keyMoveOf(e: KeyboardEvent): KeyMove | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const edge = e.shiftKey ? 'due' : 'body';
  switch (e.key) {
    case 'ArrowLeft':
      return { days: document.dir === 'rtl' ? 1 : -1, minutes: 0, edge };
    case 'ArrowRight':
      return { days: document.dir === 'rtl' ? -1 : 1, minutes: 0, edge };
    case 'ArrowUp':
      return { days: 0, minutes: -15, edge: e.shiftKey ? 'end' : 'body' };
    case 'ArrowDown':
      return { days: 0, minutes: 15, edge: e.shiftKey ? 'end' : 'body' };
    default:
      return null;
  }
}

function Grip({ edge, payload, overdue, label }: { edge: 'start' | 'due'; payload: DragPayload; overdue: boolean; label: string }) {
  return (
    <span
      aria-hidden="true"
      draggable
      data-grip={edge}
      title={label}
      onDragStart={(e) => {
        e.stopPropagation();
        startDrag(e, payload);
      }}
      onDragEnd={endDrag}
      onClick={(e) => e.stopPropagation()}
      className={`flex w-4 flex-none cursor-ew-resize items-center justify-center self-stretch ${edge === 'due' && overdue ? 'text-overdue' : ''} hover:bg-ink/10`}
    >
      {edge === 'start' ? <StartIcon /> : <DueIcon />}
    </span>
  );
}

/**
 * A task on the month grid or the week's All day row: a bar across its days (▶ at its start, ⚑ at its
 * due day — each a handle to drag that date alone), or a one-day mark. The body drags the whole task
 * (start and due together); a click opens its details. Alt+←/→ moves it a day, Alt+Shift+←/→ its due
 * date alone.
 */
export function TaskBar({
  item,
  role,
  startsHere,
  endsHere,
  color,
  draggable,
  grabDayAt,
  onOpen,
  onKeyMove,
  detailed = false,
  lines = 1,
  showKey = false,
  sub,
}: {
  item: SpanItem;
  role: 'bar' | 'start' | 'due' | 'single';
  startsHere: boolean;
  endsHere: boolean;
  color?: string;
  draggable: boolean;
  /** The day under the pointer when a drag starts. */
  grabDayAt: (clientX: number, el: HTMLElement) => string;
  onOpen: (item: SpanItem) => void;
  onKeyMove?: (item: SpanItem, move: KeyMove) => void;
  /** Detailed rows: the title wraps to two lines. */
  detailed?: boolean;
  /** Lines of title (Month: 1 compact, 2 comfortable, 3 detailed — owner: "names not cut"). */
  lines?: 1 | 2 | 3;
  /** The task's number always (Week and Day); otherwise only where a day is wide enough (2xl). */
  showKey?: boolean;
  /** Words after the title (Week and Day: the project). */
  sub?: string;
}) {
  const s = STATUS_META[item.status];
  const overdue = item.status === 'overdue';
  const number = item.kind === 'task' ? item.task.key : null;
  const name = barName(item, role);
  const showStart = startsHere && (role === 'bar' || role === 'start');
  const showDue = endsHere && (role === 'bar' || role === 'due' || role === 'single');
  return (
    <div
      role="button"
      tabIndex={0}
      data-item={item.key}
      data-role={role}
      draggable={draggable || undefined}
      aria-label={name}
      title={`${item.task.key} · ${item.task.title}${item.start && item.due ? ` · ${dayLabel(item.start)} – ${dayLabel(item.due)}` : ''}`}
      onDragStart={(e) => startDrag(e, { kind: 'task', id: item.task.id, grip: 'body', grabDay: grabDayAt(e.clientX, e.currentTarget) })}
      onDragEnd={endDrag}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(item);
          return;
        }
        const move = keyMoveOf(e);
        // Alt + arrows move a calendar item — never the browser's Back / Forward.
        if (move) e.preventDefault();
        if (move && draggable && move.days && onKeyMove) onKeyMove(item, move);
      }}
      aria-keyshortcuts={draggable ? 'Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight' : undefined}
      style={color ? { borderInlineStartColor: color } : undefined}
      className={`group/bar flex w-full min-w-0 items-center gap-1 rounded-md border border-s-[3px] text-start text-xs leading-4 transition-colors hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${detailed ? 'min-h-6 py-[3px]' : lines === 3 ? 'h-[52px] py-[2px]' : lines === 2 ? 'h-[38px] py-[2px]' : 'h-6'} [@media(pointer:coarse)]:min-h-[28px] ${s.chip} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {showStart ? (
        draggable ? <Grip edge="start" overdue={false} label="Drag to change the start date" payload={{ kind: 'task', id: item.task.id, grip: 'start', grabDay: item.start ?? '' }} /> : <span className="ps-1"><StartIcon /></span>
      ) : (
        <span className="w-1 flex-none" />
      )}
      {/* Two lines with its number in sight (Week's narrow All day row): the number on the first, the title under it. */}
      <span className={`min-w-0 flex-1 ${showKey && lines > 1 ? 'flex flex-col' : 'flex items-center gap-1'}`}>
        <span className="flex min-w-0 flex-none items-center gap-1">
          <span data-status-dot aria-hidden="true" className={`inline-block h-1.5 w-1.5 flex-none rounded-full ${item.kind === 'projected' ? 'border border-dashed border-ink-2' : statusClass(item.task.columnCategory).dot}`} />
          {number ? <TaskKey value={number} dense className={showKey ? '' : 'hidden 2xl:inline-block'} /> : null}
        </span>
        <span dir="auto" className={`min-w-0 font-medium ${showKey && lines > 1 ? 'truncate' : detailed || lines === 2 ? 'line-clamp-2 [overflow-wrap:anywhere]' : lines === 3 ? 'line-clamp-3 [overflow-wrap:anywhere]' : 'truncate'}`}>
          {item.task.title}
          {sub ? <span className="font-normal text-ink-2"> · {sub}</span> : null}
        </span>
        {/* Waiting for approval: an hourglass, as on the board (its words are in the name, and on hover). */}
        {item.kind === 'task' && item.status !== 'done' && isWaitingForApproval(item.task) ? (
          <span data-mark="waiting" className="flex-none [&_svg]:!text-warning" title="Waiting for approval">
            <WaitingIcon size={12} />
          </span>
        ) : null}
        {item.recurring ? <span className="flex-none opacity-70" title="Repeats">{STATUS_META.projected.icon}</span> : null}
      </span>
      {showDue ? (
        draggable ? <Grip edge="due" overdue={overdue} label="Drag to change the due date" payload={{ kind: 'task', id: item.task.id, grip: 'due', grabDay: item.due ?? '' }} /> : <span className={`pe-1 ${overdue ? 'text-overdue' : ''}`}><DueIcon /></span>
      ) : (
        <span className="w-1 flex-none" />
      )}
    </div>
  );
}

/** "09:00–10:30" of a block, in the calendar's zone. */
export function blockTimes(b: { startAt: string; endAt: string }, timeZone: string): string {
  return `${timeLabel(zonedClock(new Date(b.startAt), timeZone).minutes)}–${timeLabel(zonedClock(new Date(b.endAt), timeZone).minutes)}`;
}

/** The words a screen reader hears for a work block. */
export function blockName(b: CalBlock, timeZone: string): string {
  const who = b.mine ? '' : ` for ${b.userName}`;
  const by = b.plannedById !== b.userId ? `, planned by ${b.plannedByName}` : '';
  return `Planned${who}: ${b.taskKey} ${b.taskTitle}, ${dayLabel(zonedClock(new Date(b.startAt), timeZone).day)} ${blockTimes(b, timeZone)}${by}`;
}

/** Planned time (a work block) in a list or a month day: hatched, "Planned · 09:00–10:00 RIG-12 …". */
export function BlockChip({ block, timeZone, onOpen, draggable, onKeyMove, tall = false }: { block: CalBlock; timeZone: string; onOpen: (b: CalBlock) => void; draggable: boolean; onKeyMove?: (b: CalBlock, m: KeyMove) => void; tall?: boolean }) {
  return (
    <button
      type="button"
      data-block={block.id}
      draggable={draggable || undefined}
      onDragStart={(e) => startDrag(e, { kind: 'block', id: block.id, grip: 'body', grabOffset: 0 })}
      onDragEnd={endDrag}
      onClick={() => onOpen(block)}
      onKeyDown={(e) => {
        const m = keyMoveOf(e);
        if (m) e.preventDefault();
        if (m && draggable && onKeyMove) onKeyMove(block, m);
      }}
      aria-label={blockName(block, timeZone)}
      title={blockName(block, timeZone)}
      style={HATCH_STYLE}
      className={`flex h-6 w-full min-w-0 items-center gap-1 rounded-md border border-dashed border-brand/50 bg-surface px-1.5 text-start text-[11px] leading-4 text-ink transition-colors hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${tall ? '[@media(pointer:coarse)]:!h-11' : '[@media(pointer:coarse)]:min-h-[28px]'} ${block.done ? 'opacity-60' : ''} ${draggable ? 'cursor-grab' : ''}`}
    >
      <span className="flex-none font-semibold text-brand">Planned</span>
      <span className="flex-none tabular-nums text-ink-2">{blockTimes(block, timeZone).split('–')[0]}</span>
      <span dir="auto" className="min-w-0 truncate font-medium">
        {block.mine ? '' : `${block.userName.split(' ')[0]}: `}
        {block.taskTitle}
      </span>
    </button>
  );
}

/** A reminder in words for a screen reader. */
export function reminderName(r: CalReminder, timeZone: string): string {
  const { day, minutes } = zonedClock(new Date(r.fireAt), timeZone);
  const state = r.state === 'muted' ? ', muted' : r.state === 'sent' ? ', sent' : r.state === 'missed' ? ', missed' : '';
  return `Reminder ${dayLabel(day)} ${timeLabel(minutes)}: ${r.taskKey} ${r.taskTitle}${r.setByName ? `, set by ${r.setByName}` : ''}${state}`;
}

/** A day's reminders as one bell with their number (a month day's corner). */
export function ReminderBell({ reminders, timeZone, onOpen, day }: { reminders: CalReminder[]; timeZone: string; onOpen: () => void; day: string }) {
  if (reminders.length === 0) return null;
  const allMuted = reminders.every((r) => r.state === 'muted');
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${reminders.length} ${reminders.length === 1 ? 'reminder' : 'reminders'} on ${dayLabel(day)}`}
      title={reminders.map((r) => reminderName(r, timeZone)).join('\n')}
      data-reminders={reminders.length}
      className="inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full px-1 text-[11px] font-semibold text-warning hover:bg-ground [@media(pointer:coarse)]:h-7"
    >
      <BellIcon muted={allMuted} />
      {reminders.length > 1 ? <span className="tabular-nums">{reminders.length}</span> : null}
    </button>
  );
}

/** A small "Holiday name" tag on a day off (a weekend day is shaded only). */
export function DayOffTag({ name, className = '' }: { name: string; className?: string }): ReactNode {
  return (
    <span title={`${name} — a day off`} className={`min-w-0 truncate rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-2 ${className}`}>
      {name}
    </span>
  );
}
