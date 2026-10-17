import { describe, it, expect } from 'vitest';
import { chipSlots } from './calendar-fit';

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

  it('keeps room for “+N more” when they don’t all fit', () => {
    // 120px: room for three entries alone, but only two and the "+N more" line.
    expect(chipSlots(120, 4)).toBe(2);
  });

  it('fills a tall row', () => {
    expect(chipSlots(200, 10)).toBe(6);
    expect(chipSlots(200, 7)).toBe(6);
    expect(chipSlots(200, 6)).toBe(6);
  });

  it('shows one entry in a short row when only one fits, and none but “+N more” when even that doesn’t', () => {
    expect(chipSlots(60, 1)).toBe(1);
    expect(chipSlots(60, 2)).toBe(0);
    expect(chipSlots(40, 1)).toBe(0);
  });
});
