import { describe, it, expect } from 'vitest';
import { chipSlots, MONTH_CELL, MONTH_CELL_TOUCH } from './calendar-fit';

// A month cell sized to the window: its day number on top, then one-line entries, and a
// "+N more" line when they don't all fit. How many entries go in is worked out from the height.
describe('chipSlots', () => {
  it('shows three when the height isn’t known (the month isn’t sized to the window)', () => {
    expect(chipSlots(undefined, 6)).toBe(3);
    expect(chipSlots(0, 6)).toBe(3);
  });

  it('shows every entry when they all fit', () => {
    expect(chipSlots(120, 3)).toBe(3);
    expect(chipSlots(120, 0)).toBe(0);
  });

  it('on a touch screen, entries and “+N more” are 28px tall, so fewer fit', () => {
    // 165px of room: 4 entries (30px each with the gap) and the 28px "+N more" line.
    expect(chipSlots(200, 10, true)).toBe(4);
    // 85px: three would need 88px, so one entry and "+N more".
    expect(chipSlots(120, 3, true)).toBe(1);
    expect(chipSlots(120, 2, true)).toBe(2);
    expect(chipSlots(undefined, 6, true)).toBe(3);
  });

  it('keeps room for “+N more” when they don’t all fit', () => {
    // 120px: room for three entries alone, but only two and the "+N more" line.
    expect(chipSlots(120, 4)).toBe(2);
  });

  it('fills a tall row', () => {
    // 165px of room: 5 entries and the 22px "+N more" line, or all 6 when they fit without it.
    expect(chipSlots(200, 10)).toBe(5);
    expect(chipSlots(200, 7)).toBe(5);
    expect(chipSlots(200, 6)).toBe(6);
  });

  it('shows one entry in a short row when only one fits, and none but “+N more” when even that doesn’t', () => {
    expect(chipSlots(60, 1)).toBe(1);
    expect(chipSlots(60, 2)).toBe(0);
    expect(chipSlots(40, 1)).toBe(0);
  });
});

describe('month cell sizes', () => {
  // 22px entries 3px apart: each entry's 24px target circle clears its neighbours with room to spare,
  // even when a cell sits on a fraction of a pixel (2px apart sat exactly on the limit).
  it('keeps entries 3px apart', () => {
    expect(MONTH_CELL.gap).toBe(3);
    expect(MONTH_CELL.pitch).toBe(25);
    expect(MONTH_CELL.chrome).toBe(36);
    expect(MONTH_CELL_TOUCH.pitch).toBe(31);
  });
});
