import { describe, it, expect } from 'vitest';
import { isWholeDate, isBackwards } from './date-box';

describe('date boxes: what a date field reports while it is being typed', () => {
  it('accepts a complete date', () => {
    expect(isWholeDate('2026-09-01')).toBe(true);
  });

  it('rejects the empty value of a half-typed date and anything that is not a date', () => {
    expect(isWholeDate('')).toBe(false);
    expect(isWholeDate('2026-9-1')).toBe(false);
    expect(isWholeDate('01/09/2026')).toBe(false);
  });

  it('rejects the year a browser reports while the year is still being typed', () => {
    // Typing "2026" passes through 0002, 0020 and 0202: real dates to the browser, never meant.
    for (const partial of ['0002-09-01', '0020-09-01', '0202-09-01']) expect(isWholeDate(partial), partial).toBe(false);
  });

  it('knows a range that ends before it starts — only once both ends are whole', () => {
    expect(isBackwards('2026-09-28', '2026-09-23')).toBe(true);
    expect(isBackwards('2026-09-23', '2026-09-23')).toBe(false);
    expect(isBackwards('2026-09-28', '')).toBe(false);
    expect(isBackwards('', '2026-09-23')).toBe(false);
    expect(isBackwards('2026-09-28', '0002-09-23')).toBe(false);
  });
});
