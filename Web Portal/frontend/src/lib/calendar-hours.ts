/**
 * The Week and Day hour grids (calendar scheduling): where something timed sits in a day (the calendar's
 * time zone), how overlapping things share a day's width, and pointer → time (15-minute steps).
 */
import { minutesOf, zonedClock, zonedInstant } from './working-days';
import { shiftDayKey } from './due-date';

/** One hour's height in the grid (px); the grid is 24 hours tall and scrolls. */
export const HOUR_PX = 48;
export const SNAP_MINUTES = 15;
const DAY_MINUTES = 24 * 60;

/** An instant's day and minutes after its midnight in `timeZone`. */
export function minutesAt(iso: string, timeZone: string): { day: string; minutes: number } {
  return zonedClock(new Date(iso), timeZone);
}

/** The instant of `minutes` after `day`'s midnight in `timeZone` (ISO). */
export function instantAt(day: string, minutes: number, timeZone: string): string {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)));
  if (m === DAY_MINUTES) return zonedInstant(shiftDayKey(day, 1), '00:00', timeZone).toISOString();
  return zonedInstant(day, timeLabel(m), timeZone).toISOString();
}

/** '09:05' for minutes after midnight ('24:00' for the day's end). */
export function timeLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Something timed cut to one day: minutes from that day's midnight (null when it isn't on it). */
export function clipToDay(span: { startAt: string; endAt: string }, day: string, timeZone: string): { start: number; end: number } | null {
  const dayStart = zonedInstant(day, '00:00', timeZone).getTime();
  const dayEnd = zonedInstant(shiftDayKey(day, 1), '00:00', timeZone).getTime();
  const s = Date.parse(span.startAt);
  const e = Date.parse(span.endAt);
  if (!(s < dayEnd && e > dayStart)) return null;
  return { start: Math.round((Math.max(s, dayStart) - dayStart) / 60_000), end: Math.round((Math.min(e, dayEnd) - dayStart) / 60_000) };
}

/** A pointer `offsetPx` below the grid's top → minutes after midnight, on a 15-minute step inside the day. */
export function snapMinutes(offsetPx: number, hourPx = HOUR_PX): number {
  if (!Number.isFinite(offsetPx)) return 0;
  const raw = (offsetPx / hourPx) * 60;
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(DAY_MINUTES - SNAP_MINUTES, snapped));
}

/**
 * Overlapping things side by side: each cluster of overlapping ones shares the width in as many columns
 * as it needs at most, each in the first free column.
 */
export function layoutColumns<T extends { id: string; start: number; end: number }>(events: readonly T[]): (T & { col: number; cols: number })[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id, 'en'));
  const out: (T & { col: number; cols: number })[] = [];
  let cluster: (T & { col: number; cols: number })[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];
  const close = () => {
    const cols = colEnds.length;
    for (const e of cluster) e.cols = cols;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) close();
    let col = colEnds.findIndex((end) => end <= e.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(e.end);
    } else colEnds[col] = e.end;
    cluster.push({ ...e, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  if (cluster.length) close();
  return out;
}

/** The working hours, highlighted in the grid (the rest dimmed): the company's, else 08:00–17:00. */
export function workingBand(hours: { start: string; end: string } | null | undefined): { start: number; end: number } {
  if (!hours) return { start: 8 * 60, end: 17 * 60 };
  return { start: minutesOf(hours.start), end: minutesOf(hours.end) };
}
