/**
 * The month sized to the window: how many one-line entries a day's cell has room for. The sizes
 * match the cell's classes in components/calendar/views.tsx (MonthCell) and the one-line chips in
 * calendar-ui.tsx (taller on a touch screen); change them together.
 */
export const MONTH_CELL = {
  /** Padding (4px top and bottom), the day number (24px), the gap under it (3px) and the bottom border. */
  chrome: 36,
  /** One one-line entry (22px) and the gap after it (3px). */
  pitch: 25,
  /**
   * The gap between entries (the last one has none after it). 3px, not 2: a 22px entry's 24px target
   * (WCAG 2.2) then clears its neighbours even when the cell sits on a fraction of a pixel.
   */
  gap: 3,
  /** The "+N more" line: as tall as an entry, a 24px target with the gap (WCAG 2.2). */
  more: 22,
} as const;

/** On a touch screen entries and "+N more" are 28px tall, so a finger can hit them. */
export const MONTH_CELL_TOUCH = { ...MONTH_CELL, pitch: 31, more: 28 } as const;

/** Entries shown when the cell's height isn't known (the month isn't sized to the window). */
export const UNSIZED_SLOTS = 3;

/**
 * How many of a day's `total` entries to show in a cell `rowHeight` pixels tall: all of them when
 * they fit, otherwise as many as leave room for the "+N more" line. `touch`: the taller touch sizes.
 */
export function chipSlots(rowHeight: number | undefined, total: number, touch = false): number {
  if (!rowHeight || rowHeight <= 0) return Math.min(total, UNSIZED_SLOTS);
  const cell = touch ? MONTH_CELL_TOUCH : MONTH_CELL;
  const room = rowHeight - cell.chrome;
  if (total * cell.pitch - cell.gap <= room) return total;
  return Math.max(0, Math.floor((room - cell.more) / cell.pitch));
}

/** A touch screen (no mouse): the month's entries are sized for a finger. */
export function isTouchScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
