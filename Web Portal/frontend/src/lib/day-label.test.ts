import { describe, it, expect } from 'vitest';
import { dayLabel } from './day-label';

describe('dayLabel', () => {
  it('names the day without commas, with the year when asked', () => {
    expect(dayLabel('2026-11-01')).toBe('Sun 1 Nov');
    expect(dayLabel('2026-11-01', { year: true })).toBe('Sun 1 Nov 2026');
    expect(dayLabel('2026-11-06', { only: 'weekday' })).toBe('Fri');
  });
});
