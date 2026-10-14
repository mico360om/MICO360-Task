import { describe, it, expect } from 'vitest';
import { dayLabel, fullDayLabel } from './calendar-ui';

describe('day labels', () => {
  it('read the same everywhere: day, date, month (three letters), year', () => {
    expect(dayLabel('2026-09-28')).toBe('Mon 28 Sep');
    expect(fullDayLabel('2026-09-28')).toBe('Mon 28 Sep 2026');
    expect(dayLabel('2026-10-10', { month: 'long', year: 'numeric' })).toBe('October 2026');
    expect(dayLabel('2026-10-10', { weekday: 'long', day: 'numeric', month: 'long' })).toBe('Saturday 10 October');
  });
});
