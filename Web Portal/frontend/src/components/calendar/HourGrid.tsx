import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CalMeeting } from '../../lib/calendar-meetings';
import type { CalendarChecklistItem } from '../../lib/calendar-checklist';
import type { CalBlock, CalReminder } from '../../api/calendar';
import { laneView, packLanes, weekSegments, type SpanItem } from '../../lib/calendar-span';
import { HOUR_PX, clipToDay, layoutColumns, minutesAt, snapMinutes, timeLabel, workingBand } from '../../lib/calendar-hours';
import { columnAt, endDrag, readDrag, startDrag, type DragPayload } from '../../lib/calendar-dnd';
import { calendarOrder } from '../../lib/calendar-order';
import { ChecklistChip, dayLabel, meetingName } from './calendar-ui';
import { BellIcon, DayOffTag, DueIcon, HATCH_STYLE, PeopleIcon, TaskBar, blockName, blockTimes, keyMoveOf, reminderName, type KeyMove } from './schedule-chips';

const ALL_DAY_LANES = 3;
const LANE_PITCH = 26;

export interface HourGridProps {
  /** The days shown: a week's seven, or one. */
  days: string[];
  label: string;
  today: string;
  timeZone: string;
  now: Date;
  items: SpanItem[];
  meetingsByDay: Map<string, CalMeeting[]>;
  /** A meeting's end (the calendar's meeting items carry its start and its time words). */
  meetingEnd: (id: string) => string | null;
  checklistByDay: Map<string, CalendarChecklistItem[]>;
  blocks: CalBlock[];
  reminders: CalReminder[];
  colorOf: (projectId: string) => string | undefined;
  /** A task's project name (shown after its title). */
  projectName?: (projectId: string) => string | undefined;
  dayOff: (day: string) => { kind: 'holiday'; name: string } | { kind: 'weekend' } | null;
  hours: { start: string; end: string } | null;
  selected: string | null;
  canDragTask: (item: SpanItem) => boolean;
  canDragBlock: (b: CalBlock) => boolean;
  canDragMeeting: (m: CalMeeting) => boolean;
  onOpenItem: (item: SpanItem) => void;
  onOpenBlock: (b: CalBlock) => void;
  onRemoveBlock: (b: CalBlock) => void;
  onOpenStep: (s: CalendarChecklistItem) => void;
  onSelectDay: (day: string) => void;
  /** An empty hour clicked: offer "New meeting at …" / "Plan time for a task…". */
  onSlot: (day: string, minutes: number, at: { x: number; y: number }) => void;
  onDropDay: (payload: DragPayload, day: string) => void;
  onDropSlot: (payload: DragPayload, day: string, minutes: number) => void;
  onKeyMoveTask: (item: SpanItem, move: KeyMove) => void;
  onKeyMoveBlock: (b: CalBlock, move: KeyMove) => void;
  onKeyMoveMeeting: (m: CalMeeting, move: KeyMove) => void;
  /** Fill the height it is given (the hours scroll inside). */
  fit: boolean;
}

type Timed =
  | { id: string; kind: 'meeting'; m: CalMeeting; start: number; end: number }
  | { id: string; kind: 'block'; b: CalBlock; start: number; end: number }
  | { id: string; kind: 'due'; item: SpanItem; start: number; end: number };

/**
 * Week and Day with hour slots (calendar scheduling): an All day row on top (tasks' bars and marks,
 * checklist items), then the day's hours — the working hours lit, the rest dimmed, days off shaded with
 * their name. Meetings are solid blocks with their times and 👥; planned time is hatched "Planned";
 * a task due at a time shows its ⚑ there; reminders are bells at their times. Drag a task into an hour
 * to plan time on it; drag planned time or a meeting (its organizer) to move it; its lower edge resizes.
 */
export function HourGrid(p: HourGridProps) {
  const n = p.days.length;
  const scrollRef = useRef<HTMLDivElement>(null);
  const band = workingBand(p.hours);
  const [allDayOpen, setAllDayOpen] = useState(false);
  const [overCol, setOverCol] = useState<number | null>(null);
  const [overSlot, setOverSlot] = useState<{ col: number; minutes: number } | null>(null);
  // Open at the working day's start (an hour before), once per set of days.
  const first = p.days[0];
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, ((band.start - 60) / 60) * HOUR_PX);
  }, [first, n, band.start]);
  const cols = `3.25rem repeat(${n}, minmax(0, 1fr))`;
  const rtl = typeof document !== 'undefined' && document.dir === 'rtl';

  // ── All day row ──
  const allDayItems = p.items.filter((i) => !(i.mode === 'due' && i.dueMinutes !== null));
  const ranked = calendarOrder(p.items);
  const entries = [
    ...weekSegments(p.days, allDayItems).map((seg) => ({ kind: 'task' as const, seg, startCol: seg.startCol, endCol: seg.endCol, order: 1000 + (ranked.get(seg.item.key) ?? 0) })),
    ...p.days.flatMap((day, col) => (p.checklistByDay.get(day) ?? []).map((s, i) => ({ kind: 'step' as const, s, startCol: col, endCol: col, order: 90_000 + i }))),
  ];
  const placed = packLanes(entries);
  const view = laneView(placed, ALL_DAY_LANES);
  const lanes = allDayOpen ? placed.reduce((m, e) => Math.max(m, e.lane + 1), 0) : view.lanes;
  const anyMore = view.more.some((x) => x > 0);
  const allDayHeight = Math.max(1, lanes + (anyMore ? 1 : 0)) * LANE_PITCH + 6;
  const grabDayAt = (clientX: number, el: HTMLElement) => {
    const row = el.closest('[data-allday]') as HTMLElement | null;
    const rect = (row ?? el).getBoundingClientRect();
    // Unmeasured (or one day): the bar's own first day here.
    const own = el.closest('[data-col]') as HTMLElement | null;
    if (rect.width === 0 || n === 1) return p.days[Number(own?.dataset.col ?? 0)]!;
    return p.days[columnAt(clientX, rect, n, rtl)]!;
  };

  // ── Timed, per day: worked out once per change of the data (not on every drag-over or minute tick) ──
  const { meetingsByDay, meetingEnd, blocks, items, reminders, timeZone } = p;
  const daysKey = p.days.join(',');
  const perDay = useMemo(() => {
    const days = daysKey.split(',');
    const timed = new Map<string, Timed[]>(days.map((d) => [d, []]));
    const bells = new Map<string, CalReminder[]>(days.map((d) => [d, []]));
    for (const day of days) {
      for (const m of meetingsByDay.get(day) ?? []) {
        const end = meetingEnd(m.id) ?? new Date(Date.parse(m.startAt) + 3600_000).toISOString();
        const c = clipToDay({ startAt: m.startAt, endAt: end }, day, timeZone);
        if (c) timed.get(day)!.push({ id: m.key, kind: 'meeting', m, start: c.start, end: Math.max(c.end, c.start + 20) });
      }
    }
    // A block on its start day and (past midnight) its end day — each block read once.
    for (const b of blocks) {
      const first = minutesAt(b.startAt, timeZone).day;
      const last = minutesAt(new Date(Date.parse(b.endAt) - 1).toISOString(), timeZone).day;
      for (const day of first === last ? [first] : [first, last]) {
        if (!timed.has(day)) continue;
        const c = clipToDay(b, day, timeZone);
        if (c) timed.get(day)!.push({ id: `b:${b.id}`, kind: 'block', b, start: c.start, end: Math.max(c.end, c.start + 15) });
      }
    }
    for (const item of items) {
      if (item.due && item.dueMinutes !== null && timed.has(item.due)) timed.get(item.due)!.push({ id: `due:${item.key}`, kind: 'due', item, start: item.dueMinutes, end: item.dueMinutes + 30 });
    }
    for (const r of reminders) bells.get(minutesAt(r.fireAt, timeZone).day)?.push(r);
    return { laid: new Map([...timed].map(([d, list]) => [d, layoutColumns(list)])), bells };
  }, [daysKey, meetingsByDay, meetingEnd, blocks, items, reminders, timeZone]);
  const remindersOf = (day: string) => perDay.bells.get(day) ?? [];
  const nowAt = minutesAt(p.now.toISOString(), p.timeZone);

  const slotFromEvent = (e: React.DragEvent | React.MouseEvent, offsetMinutes: number | null = null) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Grabbed somewhere inside (a block or meeting moved): its top goes to the nearest mark; else the slot under the pointer.
    return snapMinutes(e.clientY - rect.top - ((offsetMinutes ?? 0) / 60) * HOUR_PX, HOUR_PX, offsetMinutes !== null);
  };
  const grabOffset = (e: React.DragEvent, el: HTMLElement) => Math.max(0, Math.round(((e.clientY - el.getBoundingClientRect().top) / HOUR_PX) * 60));

  return (
    <div role="region" aria-label={p.label} className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface ${p.fit ? 'h-full' : ''}`}>
      {/* Day headers */}
      <div className="grid flex-none border-b border-line bg-ground" style={{ gridTemplateColumns: cols }}>
        <div />
        {p.days.map((day) => {
          const off = p.dayOff(day);
          const isToday = day === p.today;
          const bells = remindersOf(day).length;
          return (
            <div key={day} data-day-head={day} className={`min-w-0 border-s border-line px-1 py-1 ${off ? 'bg-ink/[0.03]' : ''}`}>
              <button
                type="button"
                onClick={() => p.onSelectDay(day)}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={p.selected !== null ? p.selected === day : undefined}
                aria-label={`${dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}${off?.kind === 'holiday' ? `, ${off.name} (a day off)` : off ? ', a day off' : ''}${bells ? `, ${bells} ${bells === 1 ? 'reminder' : 'reminders'}` : ''}`}
                className={`flex w-full flex-col items-center rounded-md px-1 py-0.5 transition-colors hover:bg-surface [@media(pointer:coarse)]:min-h-11 ${isToday ? 'text-brand' : 'text-ink'} ${p.selected === day ? 'ring-2 ring-brand' : ''}`}
              >
                <span className="text-[11px] font-bold uppercase tracking-wide">{dayLabel(day, { weekday: 'short' })}</span>
                <span className={`grid h-7 min-w-7 place-items-center rounded-full px-1 text-sm font-semibold tabular-nums ${isToday ? 'bg-brand text-white' : ''}`}>{Number(day.slice(8))}</span>
              </button>
              {off?.kind === 'holiday' ? <DayOffTag name={off.name} className="block text-center" /> : null}
            </div>
          );
        })}
      </div>

      {/* All day */}
      <div className="grid flex-none border-b border-line" style={{ gridTemplateColumns: cols }}>
        <div className="flex items-start justify-end pe-1.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-2">All day</div>
        <div
          data-allday
          role="list"
          aria-label="All day"
          className="relative"
          style={{ gridColumn: `2 / span ${n}`, height: allDayHeight }}
          onDragOver={(e) => {
            e.preventDefault();
            const col = columnAt(e.clientX, e.currentTarget.getBoundingClientRect(), n, rtl);
            if (col !== overCol) setOverCol(col);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setOverCol(null);
            const payload = readDrag(e);
            if (payload) p.onDropDay(payload, p.days[columnAt(e.clientX, e.currentTarget.getBoundingClientRect(), n, rtl)]!);
          }}
        >
          <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden="true">
            {p.days.map((day, col) => (
              <div key={day} className={`border-s border-line ${p.dayOff(day) ? 'bg-ink/[0.03]' : ''} ${overCol === col ? 'bg-brand/10' : ''}`} />
            ))}
          </div>
          {placed
            .filter((e) => e.lane < lanes)
            .map((e) => {
              const span = e.endCol - e.startCol + 1;
              const style = { top: 3 + e.lane * LANE_PITCH, insetInlineStart: `calc(${(e.startCol / n) * 100}% + 2px)`, width: `calc(${(span / n) * 100}% - 4px)` };
              return (
                <div role="listitem" data-col={e.startCol} key={e.kind === 'task' ? `t:${e.seg.item.key}:${e.seg.role}` : `cl:${e.s.id}`} className="absolute z-10" style={style}>
                  {e.kind === 'task' ? (
                    <TaskBar
                      item={e.seg.item}
                      role={e.seg.role}
                      startsHere={e.seg.startsHere}
                      endsHere={e.seg.endsHere}
                      color={p.colorOf(e.seg.item.task.projectId)}
                      draggable={p.canDragTask(e.seg.item)}
                      grabDayAt={grabDayAt}
                      onOpen={p.onOpenItem}
                      onKeyMove={p.onKeyMoveTask}
                      showKey
                      sub={p.projectName?.(e.seg.item.task.projectId)}
                    />
                  ) : (
                    <ChecklistChip item={e.s} lines={1} late={!e.s.done && e.s.dueDate.slice(0, 10) < p.today} onOpen={p.onOpenStep} />
                  )}
                </div>
              );
            })}
          {anyMore ? (
            <div role="listitem" className="absolute z-10 flex" style={{ top: 3 + lanes * LANE_PITCH, insetInlineStart: 2 }}>
              <button
                type="button"
                onClick={() => setAllDayOpen((o) => !o)}
                aria-expanded={allDayOpen}
                className="flex h-6 items-center rounded px-1.5 text-[11px] font-semibold text-brand hover:bg-brand/[0.06] hover:underline [@media(pointer:coarse)]:h-[28px]"
              >
                {allDayOpen ? 'Show fewer' : `+${placed.filter((x) => x.lane >= view.lanes).length} more all day`}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Hours */}
      <div ref={scrollRef} className={`overflow-y-auto overscroll-contain ${p.fit ? 'min-h-0 flex-1' : 'h-[34rem]'}`}>
        <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="relative" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="absolute end-1.5 -translate-y-1/2 text-[10px] tabular-nums text-ink-3" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : timeLabel(h * 60)}
              </span>
            ))}
          </div>
          {p.days.map((day, col) => {
            const off = p.dayOff(day);
            const laid = perDay.laid.get(day) ?? [];
            const bells = remindersOf(day);
            return (
              <div
                key={day}
                data-hours={day}
                role="list"
                aria-label={`${dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}, by the hour`}
                className="relative border-s border-line"
                style={{
                  backgroundImage: `linear-gradient(to bottom, transparent ${HOUR_PX - 1}px, rgb(var(--c-line)) ${HOUR_PX - 1}px)`,
                  backgroundSize: `100% ${HOUR_PX}px`,
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button,a,[role="button"]')) return;
                  p.onSlot(day, slotFromEvent(e), { x: e.clientX, y: e.clientY });
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  const minutes = slotFromEvent(e);
                  if (!overSlot || overSlot.col !== col || overSlot.minutes !== minutes) setOverSlot({ col, minutes });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverSlot(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverSlot(null);
                  const payload = readDrag(e);
                  if (!payload) return;
                  const offset = payload.kind === 'block' && payload.grip === 'body' ? payload.grabOffset : payload.kind === 'meeting' ? payload.grabOffset : null;
                  p.onDropSlot(payload, day, slotFromEvent(e, offset));
                }}
              >
                {/* Outside working hours (and all of a day off): dimmed. */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 bg-ink/[0.045]" style={{ height: off ? '100%' : (band.start / 60) * HOUR_PX }} />
                {off ? null : <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink/[0.045]" style={{ top: (band.end / 60) * HOUR_PX }} />}
                {overSlot?.col === col ? (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 z-20 rounded border-2 border-dashed border-brand bg-brand/10" style={{ top: (overSlot.minutes / 60) * HOUR_PX, height: HOUR_PX }} />
                ) : null}
                {day === nowAt.day ? (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger" style={{ top: (nowAt.minutes / 60) * HOUR_PX }}>
                    <span className="absolute -start-1 -top-[5px] h-2 w-2 rounded-full bg-danger" />
                  </div>
                ) : null}
                {laid.map((t) => {
                  const style = {
                    top: (t.start / 60) * HOUR_PX + 1,
                    height: Math.max(20, ((t.end - t.start) / 60) * HOUR_PX - 2),
                    insetInlineStart: `calc(${(t.col / t.cols) * 100}% + 2px)`,
                    width: `calc(${100 / t.cols}% - 4px)`,
                  };
                  return (
                    <div role="listitem" key={t.id} className="absolute z-10" style={style}>
                      {t.kind === 'meeting' ? (
                        <MeetingBlock m={t.m} end={p.meetingEnd(t.m.id)} color={t.m.projectId ? p.colorOf(t.m.projectId) : undefined} draggable={p.canDragMeeting(t.m)} grabOffset={grabOffset} onKeyMove={p.onKeyMoveMeeting} />
                      ) : t.kind === 'block' ? (
                        <WorkBlock b={t.b} timeZone={p.timeZone} draggable={p.canDragBlock(t.b)} grabOffset={grabOffset} onOpen={p.onOpenBlock} onRemove={p.onRemoveBlock} onKeyMove={p.onKeyMoveBlock} />
                      ) : (
                        <DueFlag item={t.item} color={p.colorOf(t.item.task.projectId)} draggable={p.canDragTask(t.item)} onOpen={p.onOpenItem} onKeyMove={p.onKeyMoveTask} />
                      )}
                    </div>
                  );
                })}
                {bells.map((r) => {
                  const at = minutesAt(r.fireAt, p.timeZone).minutes;
                  return (
                    <div role="listitem" key={`r:${r.id}`} className="absolute -start-px z-30" style={{ top: (at / 60) * HOUR_PX - 9 }}>
                      <span
                        role="img"
                        aria-label={reminderName(r, p.timeZone)}
                        title={reminderName(r, p.timeZone)}
                        data-reminder={r.id}
                        className={`grid h-[18px] w-[18px] place-items-center rounded-full border border-warning/60 bg-surface text-warning shadow-sm ${r.state === 'muted' || r.state === 'sent' || r.state === 'missed' ? 'opacity-60' : ''}`}
                      >
                        <BellIcon size={11} muted={r.state === 'muted'} />
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A meeting in the hours: a solid block with its times, title and 👥; its organizer drags it (or Alt+arrows). */
function MeetingBlock({ m, end, color, draggable, grabOffset, onKeyMove }: { m: CalMeeting; end: string | null; color?: string; draggable: boolean; grabOffset: (e: React.DragEvent, el: HTMLElement) => number; onKeyMove: (m: CalMeeting, move: KeyMove) => void }) {
  return (
    <Link
      to={`/meetings/${m.id}`}
      data-item={m.key}
      data-meeting={m.id}
      aria-label={meetingName(m)}
      title={`${m.time} · ${m.title}${m.location ? ` · ${m.location}` : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        startDrag(e, { kind: 'meeting', id: m.id, grabOffset: grabOffset(e, e.currentTarget) });
      }}
      onDragEnd={endDrag}
      onKeyDown={(e) => {
        const move = keyMoveOf(e);
        if (move) e.preventDefault();
        if (move && draggable && move.edge === 'body') onKeyMove(m, move);
      }}
      aria-keyshortcuts={draggable ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight' : undefined}
      style={color ? { borderInlineStartColor: color } : undefined}
      className={`flex h-full w-full min-w-0 flex-col overflow-hidden rounded-md border border-s-[3px] border-brand/50 bg-brand/[0.14] px-1.5 py-0.5 text-start text-[11px] leading-4 text-ink transition-colors hover:bg-brand/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${m.cancelled ? 'opacity-60' : ''} ${draggable ? 'cursor-grab' : ''}`}
    >
      <span className="flex items-center gap-1 font-semibold">
        <PeopleIcon size={11} />
        <span className={`min-w-0 truncate ${m.cancelled ? 'line-through' : ''}`} dir="auto">{m.title}</span>
      </span>
      <span className="truncate tabular-nums text-ink-2">{end ? m.time : m.time}{m.location ? ` · ${m.location}` : ''}</span>
    </Link>
  );
}

/** Planned time (a work block) in the hours: hatched "Planned: KEY-12 …"; drag to move, its lower edge to resize; × removes it. */
function WorkBlock({
  b,
  timeZone,
  draggable,
  grabOffset,
  onOpen,
  onRemove,
  onKeyMove,
}: {
  b: CalBlock;
  timeZone: string;
  draggable: boolean;
  grabOffset: (e: React.DragEvent, el: HTMLElement) => number;
  onOpen: (b: CalBlock) => void;
  onRemove: (b: CalBlock) => void;
  onKeyMove: (b: CalBlock, move: KeyMove) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  return (
    <div ref={container} data-block={b.id} style={HATCH_STYLE} className={`group/block relative flex h-full w-full min-w-0 overflow-hidden rounded-md border border-dashed border-brand/60 bg-surface ${b.done ? 'opacity-60' : ''}`}>
      <button
        type="button"
        draggable={draggable || undefined}
        onDragStart={(e) => startDrag(e, { kind: 'block', id: b.id, grip: 'body', grabOffset: grabOffset(e, container.current ?? e.currentTarget) })}
        onDragEnd={endDrag}
        onClick={() => onOpen(b)}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && b.canChange) {
            e.preventDefault();
            onRemove(b);
            return;
          }
          const move = keyMoveOf(e);
          if (move) e.preventDefault();
          if (move && draggable) onKeyMove(b, move);
        }}
        aria-keyshortcuts={draggable ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown Delete' : undefined}
        aria-label={blockName(b, timeZone)}
        title={`${blockName(b, timeZone)}${b.canChange ? ' — drag to move, its lower edge to resize' : ''}`}
        className={`flex min-w-0 flex-1 flex-col px-1.5 py-0.5 text-start text-[11px] leading-4 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${draggable ? 'cursor-grab' : ''}`}
      >
        <span className="truncate font-semibold">
          <span className="text-brand">Planned:</span> {b.taskKey}
          {b.mine ? '' : ` · ${b.userName}`}
        </span>
        <span dir="auto" className="truncate">{b.taskTitle}</span>
        <span className="truncate tabular-nums text-ink-2">{blockTimes(b, timeZone)}</span>
      </button>
      {b.canChange ? (
        <button
          type="button"
          onClick={() => onRemove(b)}
          aria-label={`Remove planned time: ${b.taskKey} ${blockTimes(b, timeZone)}`}
          title="Remove this planned time"
          className="grid h-5 w-5 flex-none place-items-center self-start rounded text-ink-2 opacity-70 hover:bg-ink/10 hover:text-ink hover:opacity-100 group-hover/block:opacity-100 [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      ) : null}
      {draggable ? (
        <span
          aria-hidden="true"
          draggable
          title="Drag to change the end"
          data-grip="end"
          onDragStart={(e) => {
            e.stopPropagation();
            startDrag(e, { kind: 'block', id: b.id, grip: 'end', grabOffset: 0 });
          }}
          onDragEnd={endDrag}
          className="absolute inset-x-2 bottom-0 h-1.5 cursor-ns-resize rounded-full bg-brand/40 opacity-0 transition-opacity group-hover/block:opacity-100"
        />
      ) : null}
    </div>
  );
}

/** A task due at a time: its ⚑ at that time (drag the ⚑ to change the due time — call 4). */
function DueFlag({ item, color, draggable, onOpen, onKeyMove }: { item: SpanItem; color?: string; draggable: boolean; onOpen: (i: SpanItem) => void; onKeyMove: (i: SpanItem, m: KeyMove) => void }) {
  const overdue = item.status === 'overdue';
  return (
    <div
      role="button"
      tabIndex={0}
      data-item={`due:${item.key}`}
      data-flag={item.task.id}
      draggable={draggable || undefined}
      onDragStart={(e) => startDrag(e, { kind: 'task', id: item.task.id, grip: 'due', grabDay: item.due ?? '' })}
      onDragEnd={endDrag}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(item);
          return;
        }
        const move = keyMoveOf(e);
        if (move) e.preventDefault();
        if (move && draggable && move.days) onKeyMove(item, { ...move, edge: 'due' });
      }}
      aria-label={`${item.task.key} ${item.task.title}, due at ${timeLabel(item.dueMinutes ?? 0)}${overdue ? ', overdue' : ''}`}
      title={`${item.task.key} · ${item.task.title} — due ${timeLabel(item.dueMinutes ?? 0)}`}
      style={color ? { borderInlineStartColor: color } : undefined}
      className={`flex h-full min-h-5 w-full min-w-0 items-start gap-1 overflow-hidden rounded-md border border-s-[3px] bg-surface px-1.5 py-0.5 text-[11px] leading-4 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${overdue ? 'border-overdue/60 text-overdue' : 'border-line text-ink'} ${draggable ? 'cursor-grab' : ''}`}
    >
      <span className={`mt-px ${overdue ? 'text-overdue' : 'text-ink-2'}`}><DueIcon /></span>
      <span className="flex-none tabular-nums font-semibold">{timeLabel(item.dueMinutes ?? 0)}</span>
      <span dir="auto" className="min-w-0 truncate font-medium">{item.task.title}</span>
    </div>
  );
}

/** Keep the grid's now-line moving (once a minute). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
