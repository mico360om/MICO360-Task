import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CalItem } from '../../lib/calendar-model';
import type { CalMeeting } from '../../lib/calendar-meetings';
import { monthOf, monthWeeks, weekDays, weekdayLabels, type WeekStart } from '../../lib/calendar';
import { MeetingChip, STATUS_META, TaskChip, dayLabel } from './calendar-ui';
import { chipSlots, isTouchScreen } from '../../lib/calendar-fit';

/** Overdue tasks listed before "Show all" in the agenda. */
const OVERDUE_PREVIEW = 8;

const FULL_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What every view needs to draw and act on tasks. */
export interface ViewProps {
  today: string;
  weekStart: WeekStart;
  byDay: Map<string, CalItem[]>;
  colorOf: (projectId: string) => string | undefined;
  canDrag: (item: CalItem) => boolean;
  onOpen: (item: CalItem) => void;
  /** Show every task of a day (and a way to add one there). */
  onOpenDay: (day: string) => void;
  /** A task dropped on a day. */
  onDrop: (taskId: string, day: string) => void;
  /** Meetings by day (shown before the day's tasks). */
  meetingsByDay?: Map<string, CalMeeting[]>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const countLabel = (n: number, meetings = 0) => [meetings ? plural(meetings, 'meeting', 'meetings') : '', n ? plural(n, 'task', 'tasks') : ''].filter(Boolean).map((s) => `, ${s}`).join('');
const meetingsOf = (p: ViewProps, day: string) => p.meetingsByDay?.get(day) ?? [];
/** A meeting's line under its title: its times and place. */
const meetingMeta = (m: CalMeeting) => [m.time, m.location, m.cancelled ? 'Cancelled' : null].filter(Boolean).join(' · ');

/** Drag-and-drop on a day: highlight while a task is over it, move the task when dropped. */
function useDropTarget(day: string, onDrop: ViewProps['onDrop']) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer?.getData('text/plain');
        if (id) onDrop(id, day);
      },
    },
  };
}

/** An element's height as it changes (undefined where it can't be measured, or while `enabled` is false). */
function useHeight(ref: RefObject<HTMLElement | null>, enabled: boolean): number | undefined {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') {
      setHeight(undefined);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h !== undefined) setHeight(Math.floor(h));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return height;
}

/**
 * A day of the month. Sized to the window (`rowHeight` known), it shows as many one-line entries
 * as fit and "+N more" for the rest; otherwise three.
 */
function MonthCell({ cellKey, dayNumber, outside, p, rowHeight }: { cellKey: string; dayNumber: number; outside: boolean; p: ViewProps; rowHeight?: number }) {
  const items = p.byDay.get(cellKey) ?? [];
  const meetings = meetingsOf(p, cellKey);
  const max = chipSlots(rowHeight, items.length + meetings.length, isTouchScreen());
  const shownMeetings = meetings.slice(0, max);
  const shown = items.slice(0, Math.max(0, max - shownMeetings.length));
  const hiddenMeetings = meetings.length - shownMeetings.length;
  const more = items.length - shown.length + hiddenMeetings;
  const moreNoun = hiddenMeetings === 0 ? (more === 1 ? 'task' : 'tasks') : hiddenMeetings === more ? (more === 1 ? 'meeting' : 'meetings') : 'items';
  const isToday = cellKey === p.today;
  const drop = useDropTarget(cellKey, p.onDrop);
  return (
    <div
      role="cell"
      data-day={cellKey}
      data-outside={outside ? 'true' : undefined}
      {...drop.props}
      className={`flex min-w-0 flex-col gap-0.5 overflow-hidden border-b border-e border-line p-1 transition-colors ${rowHeight ? 'min-h-0' : 'min-h-[7.5rem]'} ${outside ? 'bg-ground/60' : 'bg-surface'} ${isToday ? 'bg-brand/[0.06]' : ''} ${drop.over ? 'bg-brand/10 ring-2 ring-inset ring-brand/50' : ''}`}
    >
      {/* 24px tall (see lib/calendar-fit.ts). */}
      <div className="flex h-6 flex-none items-center justify-between ps-1">
        {isToday ? <span className="text-[11px] font-bold uppercase tracking-wide text-brand">Today</span> : <span />}
        <button
          type="button"
          onClick={() => p.onOpenDay(cellKey)}
          aria-label={`${dayLabel(cellKey)}${countLabel(items.length, meetings.length)}`}
          aria-current={isToday ? 'date' : undefined}
          className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[13px] font-semibold tabular-nums transition-colors hover:bg-ground ${
            isToday ? 'bg-brand text-white hover:bg-brand' : outside ? 'text-ink-3' : 'text-ink'
          }`}
        >
          {dayNumber}
        </button>
      </div>
      <ul className="flex min-w-0 flex-col gap-0.5">
        {shownMeetings.map((m) => (
          <li key={m.key} className="min-w-0">
            <MeetingChip meeting={m} color={m.projectId ? p.colorOf(m.projectId) : undefined} />
          </li>
        ))}
        {shown.map((item) => (
          <li key={item.key} className="min-w-0">
            <TaskChip item={item} color={p.colorOf(item.task.projectId)} draggable={p.canDrag(item)} onOpen={p.onOpen} lines={1} />
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          onClick={() => p.onOpenDay(cellKey)}
          aria-label={`${more} more ${moreNoun} on ${dayLabel(cellKey)}`}
          className="flex h-[22px] flex-none items-center self-start rounded px-1.5 text-[11px] font-semibold text-brand hover:bg-brand/[0.06] hover:underline [@media(pointer:coarse)]:h-[28px] [@media(pointer:coarse)]:min-h-[28px]"
        >
          +{more} more
        </button>
      ) : null}
    </div>
  );
}

/**
 * The month as a grid: a few tasks per day, the rest one click away. With `fit`, it fills the
 * height it is given, every week sharing it, and each day shows as many tasks as fit.
 */
export function MonthView({ cursor, p, label, fit = false }: { cursor: string; p: ViewProps; label: string; fit?: boolean }) {
  const { year, month0 } = monthOf(cursor);
  const weeks = monthWeeks(year, month0, p.weekStart);
  const labels = weekdayLabels(p.weekStart);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyHeight = useHeight(bodyRef, fit);
  const rowHeight = bodyHeight ? bodyHeight / weeks.length : undefined;
  return (
    <div role="table" aria-label={label} className={`overflow-hidden rounded-xl border border-line bg-surface ${fit ? 'flex h-full min-h-0 flex-col' : ''}`}>
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
        className={`[&>div:last-child>div]:border-b-0 ${fit ? 'grid min-h-0 flex-1' : ''}`}
        style={fit ? { gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` } : undefined}
      >
        {weeks.map((week) => (
          <div key={week[0]!.key} role="row" className="grid min-h-0 grid-cols-7 [&>div:last-child]:border-e-0">
            {week.map((cell) => (
              <MonthCell key={cell.key} cellKey={cell.key} dayNumber={cell.day} outside={!cell.inMonth} p={p} rowHeight={rowHeight} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A phone's month: small days with dots, and the chosen day's tasks as a list underneath. */
export function MobileMonth({ cursor, p, label, renderDayList }: { cursor: string; p: ViewProps; label: string; renderDayList: (day: string) => ReactNode }) {
  const { year, month0 } = monthOf(cursor);
  const weeks = monthWeeks(year, month0, p.weekStart);
  const inMonth = (key: string) => key.slice(0, 7) === cursor.slice(0, 7);
  const [selected, setSelected] = useState(() => (inMonth(p.today) ? p.today : `${cursor.slice(0, 7)}-01`));
  const chosen = inMonth(selected) ? selected : `${cursor.slice(0, 7)}-01`;
  return (
    <div className="flex flex-col gap-3">
      <div role="table" aria-label={label} className="rounded-xl border border-line bg-surface p-1">
        <div role="row" className="grid grid-cols-7">
          {weekdayLabels(p.weekStart).map((l, i) => (
            <div key={l} role="columnheader" className="py-1 text-center text-[11px] font-semibold uppercase text-ink-2">
              <abbr title={FULL_DAY[(p.weekStart + i) % 7]} className="no-underline">{l.slice(0, 2)}</abbr>
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]!.key} role="row" className="grid grid-cols-7">
            {week.map((cell) => {
              const items = p.byDay.get(cell.key) ?? [];
              const meetings = meetingsOf(p, cell.key);
              const isToday = cell.key === p.today;
              const isChosen = cell.key === chosen;
              return (
                <div key={cell.key} role="cell" data-day={cell.key} data-outside={cell.inMonth ? undefined : 'true'} className="p-0.5">
                  <button
                    type="button"
                    onClick={() => setSelected(cell.key)}
                    aria-label={`${dayLabel(cell.key)}${countLabel(items.length, meetings.length)}`}
                    aria-current={isToday ? 'date' : undefined}
                    aria-pressed={isChosen}
                    className={`flex h-12 w-full flex-col items-center justify-center gap-1 rounded-lg text-sm font-semibold tabular-nums transition-colors ${
                      isChosen ? 'bg-brand text-white' : isToday ? 'bg-brand/10 text-brand' : cell.inMonth ? 'text-ink hover:bg-ground' : 'text-ink-3 hover:bg-ground'
                    }`}
                  >
                    {cell.day}
                    <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                      {meetings.slice(0, 3).map((m) => (
                        <span key={m.key} className={`h-1.5 w-1.5 rotate-45 rounded-[1px] ${isChosen ? 'bg-white' : 'bg-brand'}`} />
                      ))}
                      {items.slice(0, Math.max(0, 3 - meetings.length)).map((i) => (
                        <span key={i.key} className={`h-1.5 w-1.5 rounded-full ${isChosen ? 'bg-white' : STATUS_META[i.status].dot}`} />
                      ))}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {renderDayList(chosen)}
    </div>
  );
}

/**
 * One column per day (a list per day on a phone), every task shown. With `fit`, the week fills the
 * height it is given and a long day scrolls inside its column.
 */
export function WeekView({ cursor, p, phone, meta, fit = false }: { cursor: string; p: ViewProps; phone: boolean; meta: (item: CalItem) => ReactNode; fit?: boolean }) {
  const days = weekDays(cursor, p.weekStart);
  return (
    <div className={phone ? 'flex flex-col gap-2' : `grid grid-cols-7 overflow-hidden rounded-xl border border-line ${fit ? 'h-full min-h-0' : ''}`}>
      {days.map((key) => (
        <WeekDay key={key} day={key} p={p} phone={phone} meta={meta} fit={fit && !phone} />
      ))}
    </div>
  );
}

function WeekDay({ day, p, phone, meta, fit }: { day: string; p: ViewProps; phone: boolean; meta: (item: CalItem) => ReactNode; fit: boolean }) {
  const items = p.byDay.get(day) ?? [];
  const meetings = meetingsOf(p, day);
  const isToday = day === p.today;
  const drop = useDropTarget(day, p.onDrop);
  return (
    <section
      data-day={day}
      aria-label={dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}
      {...drop.props}
      className={`flex min-w-0 flex-col gap-1.5 p-2 transition-colors ${phone ? 'rounded-xl border border-line bg-surface' : `${fit ? 'min-h-0' : 'min-h-[20rem]'} border-e border-line bg-surface last:border-e-0`} ${isToday ? 'bg-brand/[0.06]' : ''} ${drop.over ? 'bg-brand/10 ring-2 ring-inset ring-brand/50' : ''}`}
    >
      <button
        type="button"
        onClick={() => p.onOpenDay(day)}
        aria-label={`${dayLabel(day)}${countLabel(items.length, meetings.length)}`}
        aria-current={isToday ? 'date' : undefined}
        className={`flex items-baseline justify-between rounded-md px-1.5 py-1 text-start transition-colors hover:bg-ground ${isToday ? 'text-brand' : 'text-ink'}`}
      >
        <span className="text-xs font-bold uppercase tracking-wide">{dayLabel(day, { weekday: 'short' })}{isToday ? ' · Today' : ''}</span>
        <span className="text-sm font-semibold tabular-nums">{dayLabel(day, { day: 'numeric', month: 'short' })}</span>
      </button>
      {items.length === 0 && meetings.length === 0 ? (
        <p className="px-1.5 text-xs text-ink-3">Nothing due</p>
      ) : (
        <ul className={`flex flex-col gap-1 ${fit ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : ''}`}>
          {meetings.map((m) => (
            <li key={m.key}>
              <MeetingChip meeting={m} color={m.projectId ? p.colorOf(m.projectId) : undefined} meta={meetingMeta(m)} />
            </li>
          ))}
          {items.map((item) => (
            <li key={item.key}>
              <TaskChip item={item} color={p.colorOf(item.task.projectId)} draggable={p.canDrag(item)} onOpen={p.onOpen} meta={meta(item)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The days of the range as a list (from today when the range includes it), overdue work first. */
export function AgendaView({
  from,
  to,
  p,
  overdue,
  meta,
  empty,
}: {
  from: string;
  to: string;
  p: ViewProps;
  overdue: CalItem[];
  meta: (item: CalItem) => ReactNode;
  empty: ReactNode;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [allOverdue, setAllOverdue] = useState(false);
  const overdueShown = allOverdue ? overdue : overdue.slice(0, OVERDUE_PREVIEW);
  const days = [...new Set([...p.byDay.keys(), ...(p.meetingsByDay?.keys() ?? [])])].filter((d) => d >= from && d <= to).sort();
  const hasToday = p.today >= from && p.today <= to;
  const earlier = hasToday ? days.filter((d) => d < p.today) : [];
  const listed = hasToday && !showEarlier ? days.filter((d) => d >= p.today) : days;
  const chip = (item: CalItem) => (
    <li key={item.key}>
      <TaskChip item={item} color={p.colorOf(item.task.projectId)} draggable={p.canDrag(item)} onOpen={p.onOpen} lines={2} meta={meta(item)} />
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      {overdue.length > 0 ? (
        <section aria-label={`Overdue (${overdue.length})`} className="rounded-xl border border-danger/30 bg-danger-soft/40 p-3">
          <h3 className="mb-2 text-sm font-bold text-danger">Overdue · {overdue.length}</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">{overdueShown.map(chip)}</ul>
          {overdue.length > OVERDUE_PREVIEW ? (
            <button type="button" onClick={() => setAllOverdue((v) => !v)} aria-expanded={allOverdue} className="mt-2 text-xs font-semibold text-danger underline-offset-2 hover:underline">
              {allOverdue ? 'Show fewer' : `Show all ${overdue.length} overdue tasks`}
            </button>
          ) : null}
        </section>
      ) : null}
      {earlier.length > 0 ? (
        <button type="button" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} className="self-start rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:border-brand hover:text-brand">
          {showEarlier ? 'Hide earlier days' : `Show earlier days this month (${earlier.length})`}
        </button>
      ) : null}
      {listed.length === 0 && overdue.length === 0 ? empty : null}
      {listed.map((d) => {
        const items = p.byDay.get(d) ?? [];
        const meetings = meetingsOf(p, d);
        const isToday = d === p.today;
        return (
          <section key={d} data-day={d} aria-labelledby={`agenda-${d}`} className="grid gap-2 sm:grid-cols-[9rem_1fr]">
            <h3 id={`agenda-${d}`} className={`pt-1 text-sm font-bold ${isToday ? 'text-brand' : 'text-ink'}`}>
              {dayLabel(d)}
              {isToday ? <span className="ms-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold uppercase text-white">Today</span> : null}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {meetings.map((m) => (
                <li key={m.key}>
                  <MeetingChip meeting={m} color={m.projectId ? p.colorOf(m.projectId) : undefined} meta={meetingMeta(m)} lines={2} />
                </li>
              ))}
              {items.map(chip)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
