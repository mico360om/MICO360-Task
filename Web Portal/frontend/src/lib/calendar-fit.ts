/**
 * The month sized to the window: how many one-line entries a day's cell has room for. The sizes
 * match the cell's classes in components/calendar/views.tsx (MonthCell) and the one-line chips in
 * calendar-ui.tsx; change them together.
 */
export const MONTH_CELL = {
  /** Padding (4px top and bottom), the day number (24px), the gap under it (2px) and the bottom border. */
  chrome: 35,
  /** One one-line entry (22px) and the gap after it (2px). */
  pitch: 24,
  /** The gap between entries (the last one has none after it). */
  gap: 2,
  /** The "+N more" line. */
  more: 16,
} as const;

/** Entries shown when the cell's height isn't known (the month isn't sized to the window). */
export const UNSIZED_SLOTS = 3;

/**
 * How many of a day's `total` entries to show in a cell `rowHeight` pixels tall: all of them when
 * they fit, otherwise as many as leave room for the "+N more" line.
 */
export function chipSlots(rowHeight: number | undefined, total: number): number {
  if (!rowHeight || rowHeight <= 0) return Math.min(total, UNSIZED_SLOTS);
  const room = rowHeight - MONTH_CELL.chrome;
  if (total * MONTH_CELL.pitch - MONTH_CELL.gap <= room) return total;
  return Math.max(0, Math.floor((room - MONTH_CELL.more) / MONTH_CELL.pitch));
}
