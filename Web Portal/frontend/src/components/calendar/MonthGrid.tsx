import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { CalMeeting } from '../../lib/calendar-meetings';
import type { CalendarChecklistItem } from '../../lib/calendar-checklist';
import type { CalBlock, CalReminder } from '../../api/calendar';
import { monthOf, monthWeeks, weekdayLabels, type WeekStart } from '../../lib/calendar';
import { laneView, packLanes, weekSegments, type SpanItem, type WeekSegment } from '../../lib/calendar-span';
import { columnAt, readDrag, type DragPayload } from '../../lib/calendar-dnd';
import { isTouchScreen } from '../../lib/calendar-fit';
import { ChecklistChip, MeetingChip, dayLabel } from './calendar-ui';
import { BlockChip, DayOffTag, ReminderBell, TaskBar, type KeyMove } from './schedule-chips';
import { calendarOrder } from '../../lib/calendar-order';

const FULL_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** A day's top: padding, its 24px header and the gap under it (see lib/calendar-fit.ts). */
const HEAD = 28;
const CHROME = 35;
/** One lane: an entry and the gap after it (one, two or three lines of title — owner: "names not cut"). */
const PITCHES = { 1: 26, 2: 40, 3: 54 } as const;
const TOUCH_EXTRA = 4;

type Entry =
  | { kind: 'task'; seg: WeekSegment; startCol: number; endCol: number; order: number }
  | { kind: 'meeting'; m: CalMeeting; startCol: number; endCol: number; order: number }
  | { kind: 'block'; b: CalBlock; startCol: number; endCol: number; order: number }
  | { kind: 'step'; s: CalendarChecklistItem; startCol: number; endCol: number; order: number };

export interface MonthGridProps {
  cursor: string;
  label: string;
  weekStart: WeekStart;
  today: string;
  timeZone: string;
  items: SpanItem[];
  meetingsByDay: Map<string, CalMeeting[]>;
  checklistByDay: Map<string, CalendarChecklistItem[]>;
  blocksByDay: Map<string, CalBlock[]>;
  remindersByDay: Map<string, CalReminder[]>;
  colorOf: (projectId: string) => string | undefined;
  dayOff: (day: string) => { kind: 'holiday'; name: string } | { kind: 'weekend' } | null;
  selected: string | null;
  /** Lines of a title: 1 (compact rows), 2 (comfortable), 3 (detailed). */
  lines?: 1 | 2 | 3;
  canDragTask: (item: SpanItem) => boolean;
  canDragBlock: (b: CalBlock) => boolean;
  onOpenItem: (item: SpanItem) => void;
  onOpenBlock: (b: CalBlock) => void;
  onOpenStep: (s: CalendarChecklistItem) => void;
  onSelectDay: (day: string) => void;
  onEmptyDay: (day: string) => void;
  onDrop: (payload: DragPayload, day: string) => void;
  onKeyMoveTask: (item: SpanItem, move: KeyMove) => void;
  onKeyMoveBlock: (b: CalBlock, move: KeyMove) => void;
}

/** An element's height as it changes (undefined where it can't be measured). */
function useHeight(ref: RefObject<HTMLElement | null>): number | undefined {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h !== undefined) setHeight(Math.floor(h));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The month as weeks of seven days (calendar scheduling): each task a bar from ▶ its start to ⚑ its
 * due day, cut at the week's edges, in lanes shared by the week; meetings, planned time and checklist
 * items fill the gaps. Sized to the window, a crowded day shows "+N more", which opens its week in place.
 */
export function MonthGrid(p: MonthGridProps) {
  const { year, month0 } = monthOf(p.cursor);
  const weeks = monthWeeks(year, month0, p.weekStart);
  const labels = weekdayLabels(p.weekStart);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyHeight = useHeight(bodyRef);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Each week's share of the height when closed (an opened week grows to show everything).
  const rowHeight = bodyHeight ? bodyHeight / weeks.length : undefined;
  const toggle = (key: string) => setExpanded((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));
  const anyOpen = expanded.size > 0;
  return (
    <div role="table" aria-label={p.label} className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div role="rowgroup" className="flex-none">
        <div role="row" className="grid grid-cols-7 border-b border-line bg-ground">
          {labels.map((l, i) => (
            <div key={l} role="columnheader" className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-2">
              <abbr title={FULL_DAY[(p.weekStart + i) % 7]} className="no-underline">{l}</abbr>
            </div>
          ))}
        </div>
      </div>
      <div
        ref={bodyRef}
        role="rowgroup"
        className={`grid min-h-0 flex-1 ${anyOpen ? 'overflow-y-auto overscroll-contain' : ''}`}
        style={{ gridTemplateRows: weeks.map((w) => (expanded.has(w[0]!.key) ? 'auto' : 'minmax(0, 1fr)')).join(' ') }}
      >
        {weeks.map((week, wi) => (
          <MonthWeek
            key={week[0]!.key}
            p={p}
            week={week.map((c) => ({ key: c.key, day: c.day, inMonth: c.inMonth }))}
            last={wi === weeks.length - 1}
            rowHeight={rowHeight}
            open={expanded.has(week[0]!.key)}
            onToggle={() => toggle(week[0]!.key)}
          />
        ))}
      </div>
    </div>
  );
}

function MonthWeek({ p, week, last, rowHeight, open, onToggle }: { p: MonthGridProps; week: { key: string; day: number; inMonth: boolean }[]; last: boolean; rowHeight?: number; open: boolean; onToggle: () => void }) {
  const keys = week.map((c) => c.key);
  const [overCol, setOverCol] = useState<number | null>(null);
  const touch = isTouchScreen();
  // Names not cut (owner): two or three lines where the week has room for at least three lanes of them;
  // else one line (the whole title in its tooltip and in the day's list).
  const roomFor = (l: 1 | 2 | 3) => (rowHeight ? Math.floor((rowHeight - CHROME + 2) / PITCHES[l]) : 4);
  const wanted = p.lines ?? 2;
  const lines: 1 | 2 | 3 = wanted === 3 && roomFor(3) >= 3 ? 3 : wanted >= 2 && roomFor(2) >= 3 ? 2 : 1;
  const pitch = PITCHES[lines] + (touch && lines === 1 ? TOUCH_EXTRA : 0);
  // Everything of the week, in lanes: bars first (longest), then one-day entries by kind and order.
  const entries: Entry[] = [];
  const ranked = calendarOrder(p.items);
  for (const seg of weekSegments(keys, p.items)) entries.push({ kind: 'task', seg, startCol: seg.startCol, endCol: seg.endCol, order: 1000 + (ranked.get(seg.item.key) ?? 0) });
  keys.forEach((day, col) => {
    (p.meetingsByDay.get(day) ?? []).forEach((m, i) => entries.push({ kind: 'meeting', m, startCol: col, endCol: col, order: i }));
    (p.blocksByDay.get(day) ?? []).forEach((b, i) => entries.push({ kind: 'block', b, startCol: col, endCol: col, order: 50_000 + i }));
    (p.checklistByDay.get(day) ?? []).forEach((s, i) => entries.push({ kind: 'step', s, startCol: col, endCol: col, order: 90_000 + i }));
  });
  const placed = packLanes(entries);
  // Closed: as many rows as the week's share of the height holds (4 before it is measured).
  const rows = rowHeight ? Math.max(1, Math.floor((rowHeight - CHROME + 2) / pitch)) : 4;
  const closed = laneView(placed, rows);
  const allLanes = placed.reduce((n, e) => Math.max(n, e.lane + 1), 0);
  // Closed, each day shows its own rows: a crowded day gives its last to "+N more".
  const lanesOn = (col: number) => (open ? allLanes : (closed.shown[col] ?? closed.lanes));
  const shownHere = (e: { startCol: number; endCol: number; lane: number }) => {
    for (let c = e.startCol; c <= e.endCol; c++) if (e.lane >= lanesOn(c)) return false;
    return true;
  };
  const anyMore = closed.more.some((n) => n > 0);
  const height = HEAD + (allLanes + (anyMore ? 1 : 0)) * pitch + 6;
  const colOf = (clientX: number, el: HTMLElement) => {
    const row = el.closest('[data-week]') as HTMLElement | null;
    const rect = (row ?? el).getBoundingClientRect();
    return columnAt(clientX, rect, 7, document.dir === 'rtl');
  };
  /** The day a drop lands on: a day's own cell, else from where the pointer is in the week (over a bar). */
  const dropDay = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    const cellDay = target.closest('li') ? null : (target.closest('[data-day]') as HTMLElement | null)?.dataset.day;
    return cellDay && keys.includes(cellDay) ? cellDay : keys[colOf(e.clientX, e.currentTarget as HTMLElement)]!;
  };
  const countsOf = (day: string) => {
    const tasks = p.items.filter((i) => i.date === day || i.start === day).length;
    const meetings = (p.meetingsByDay.get(day) ?? []).length;
    const blocks = (p.blocksByDay.get(day) ?? []).length;
    const steps = (p.checklistByDay.get(day) ?? []).length;
    return { tasks, meetings, blocks, steps, total: tasks + meetings + blocks + steps };
  };
  const occupied = (col: number) => placed.some((e) => e.startCol <= col && e.endCol >= col);
  return (
    <div
      role="row"
      data-week={keys[0]}
      className="relative grid min-h-0 grid-cols-7"
      style={open ? { minHeight: height } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const col = colOf(e.clientX, e.currentTarget);
        if (col !== overCol) setOverCol(col);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOverCol(null);
        const payload = readDrag(e);
        if (payload) p.onDrop(payload, dropDay(e));
      }}
    >
      {week.map((cell, col) => {
        const day = cell.key;
        const off = p.dayOff(day);
        const isToday = day === p.today;
        const c = countsOf(day);
        const reminders = p.remindersByDay.get(day) ?? [];
        const counts = [c.meetings ? plural(c.meetings, 'meeting', 'meetings') : '', c.tasks ? plural(c.tasks, 'task', 'tasks') : '', c.blocks ? plural(c.blocks, 'planned block', 'planned blocks') : '', c.steps ? plural(c.steps, 'checklist item', 'checklist items') : '']
          .filter(Boolean)
          .map((s) => `, ${s}`)
          .join('');
        const offWords = off?.kind === 'holiday' ? `, ${off.name} (a day off)` : off ? ', a day off' : '';
        const more = closed.more[col] ?? 0;
        const hiddenKinds = new Set(placed.filter((x) => x.lane >= lanesOn(col) && x.startCol <= col && x.endCol >= col).map((x) => x.kind));
        const one = more === 1;
        const moreNoun =
          hiddenKinds.size !== 1 ? 'items' : hiddenKinds.has('task') ? (one ? 'task' : 'tasks') : hiddenKinds.has('meeting') ? (one ? 'meeting' : 'meetings') : hiddenKinds.has('block') ? 'planned blocks' : one ? 'checklist item' : 'checklist items';
        return (
          <div
            key={day}
            role="cell"
            data-day={day}
            data-outside={cell.inMonth ? undefined : 'true'}
            data-day-off={off ? off.kind : undefined}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button,[role="button"],a')) return;
              if (!occupied(col) && c.total === 0) p.onEmptyDay(day);
              else p.onSelectDay(day);
            }}
            className={`relative min-w-0 border-b border-e border-line p-1 transition-colors [&:last-child]:border-e-0 ${last ? 'border-b-0' : ''} ${cell.inMonth ? (off ? 'bg-ground' : 'bg-surface') : 'bg-ground/60'} ${isToday ? '!bg-brand/[0.06]' : ''} ${overCol === col ? '!bg-brand/10 ring-2 ring-inset ring-brand/50' : ''} ${p.selected === day ? 'ring-2 ring-inset ring-brand' : ''}`}
            style={open ? { minHeight: height } : undefined}
          >
            <div className="flex h-6 items-center justify-between gap-1 ps-1">
              <span className="flex min-w-0 items-center gap-1">
                {isToday ? <span className="text-[11px] font-bold uppercase tracking-wide text-brand">Today</span> : null}
                {off?.kind === 'holiday' ? <DayOffTag name={off.name} /> : null}
              </span>
              <span className="flex flex-none items-center gap-0.5">
                <ReminderBell reminders={reminders} timeZone={p.timeZone} day={day} onOpen={() => p.onSelectDay(day)} />
                <button
                  type="button"
                  onClick={() => p.onSelectDay(day)}
                  aria-label={`${dayLabel(day)}${counts}${offWords}`}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={p.selected !== null ? p.selected === day : undefined}
                  className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[13px] font-semibold tabular-nums transition-colors hover:bg-ground [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:min-w-7 ${isToday ? 'bg-brand text-white hover:bg-brand' : cell.inMonth ? 'text-ink' : 'text-ink-3'}`}
                >
                  {cell.day}
                </button>
              </span>
            </div>
            <ul className="contents">
              {placed
                .filter((e) => e.startCol === col && shownHere(e))
                .map((e) => {
                  const span = e.endCol - e.startCol + 1;
                  const style = {
                    top: HEAD + e.lane * pitch,
                    insetInlineStart: 2,
                    width: `calc(${span * 100}% + ${span - 1}px - 4px)`,
                  } as const;
                  return (
                    <li key={keyOf(e)} className="absolute z-10" style={style}>
                      {e.kind === 'task' ? (
                        <TaskBar
                          item={e.seg.item}
                          role={e.seg.role}
                          startsHere={e.seg.startsHere}
                          endsHere={e.seg.endsHere}
                          color={p.colorOf(e.seg.item.task.projectId)}
                          draggable={p.canDragTask(e.seg.item)}
                          grabDayAt={(clientX, el) => {
                            // A bar is moved by the days between where it was grabbed and where it is dropped.
                            if (e.startCol === e.endCol) return keys[e.startCol]!;
                            const rect = (el.closest('[data-week]') as HTMLElement | null)?.getBoundingClientRect();
                            if (!rect || rect.width === 0) return keys[e.startCol]!;
                            return keys[Math.max(e.startCol, Math.min(e.endCol, colOf(clientX, el)))]!;
                          }}
                          onOpen={p.onOpenItem}
                          onKeyMove={p.onKeyMoveTask}
                          lines={lines}
                        />
                      ) : e.kind === 'meeting' ? (
                        <MeetingChip meeting={e.m} color={e.m.projectId ? p.colorOf(e.m.projectId) : undefined} lines={lines === 1 ? 1 : 2} />
                      ) : e.kind === 'block' ? (
                        <BlockChip block={e.b} timeZone={p.timeZone} onOpen={p.onOpenBlock} draggable={p.canDragBlock(e.b)} onKeyMove={p.onKeyMoveBlock} />
                      ) : (
                        <ChecklistChip item={e.s} lines={1} late={!e.s.done && e.s.dueDate.slice(0, 10) < p.today} onOpen={p.onOpenStep} />
                      )}
                    </li>
                  );
                })}
            </ul>
            {more > 0 ? (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                aria-label={open ? `Show fewer on ${dayLabel(day)}` : `${more} more ${moreNoun} on ${dayLabel(day)}`}
                className="absolute z-10 flex h-6 items-center rounded px-1.5 text-[11px] font-semibold text-brand hover:bg-brand/[0.06] hover:underline [@media(pointer:coarse)]:h-[28px]"
                style={{ top: HEAD + lanesOn(col) * pitch, insetInlineStart: 2 }}
              >
                {open ? 'Show fewer' : `+${more} more`}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function keyOf(e: Entry): string {
  if (e.kind === 'task') return `t:${e.seg.item.key}:${e.seg.role}:${e.startCol}`;
  if (e.kind === 'meeting') return e.m.key;
  if (e.kind === 'block') return `b:${e.b.id}:${e.startCol}`;
  return `cl:${e.s.id}`;
}
