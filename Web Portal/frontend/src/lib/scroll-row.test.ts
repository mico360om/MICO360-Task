import { describe, it, expect } from 'vitest';
import { moreSides, revealInRow } from './scroll-row';

/** A row 300px wide showing `scrollLeft`… of 800px of content. */
const row = (scrollLeft: number, scrollWidth = 800, clientWidth = 300) => ({ scrollLeft, scrollWidth, clientWidth });

describe('a row that scrolls sideways', () => {
  it('says on which side more is hidden', () => {
    expect(moreSides(row(0, 300, 300))).toBe('none'); // it all fits
    expect(moreSides(row(0))).toBe('end');
    expect(moreSides(row(250))).toBe('both');
    expect(moreSides(row(500))).toBe('start');
    expect(moreSides(row(499.5))).toBe('start'); // a fraction of a pixel left is nothing hidden
  });

  it('scrolls a tab into view, clear of the faded edge, and leaves one already in view alone', () => {
    const r = { ...row(0), scrollTo(o: { left: number }) { this.scrollLeft = o.left; } };
    revealInRow(r, { offsetLeft: 600, offsetWidth: 100 }, 32);
    expect(r.scrollLeft).toBe(600 + 100 + 32 - 300); // its end, then the fade's width
    revealInRow(r, { offsetLeft: 500, offsetWidth: 80 }, 32);
    expect(r.scrollLeft).toBe(432); // already in view: not moved
    revealInRow(r, { offsetLeft: 40, offsetWidth: 80 }, 32);
    expect(r.scrollLeft).toBe(8); // its start, less the fade
    revealInRow(r, { offsetLeft: 0, offsetWidth: 80 }, 32);
    expect(r.scrollLeft).toBe(0); // never before the row's start
  });
});
