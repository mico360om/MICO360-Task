import { describe, it, expect } from 'vitest';
import { relativeTime } from './relative-time';

const now = new Date('2026-10-03T12:00:00Z').getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();

describe('relativeTime', () => {
  it('counts minutes, hours and days back from now', () => {
    expect(relativeTime(ago(20_000), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2d ago');
  });

  it('gives the date for anything a week or more old, and nothing for a missing time', () => {
    expect(relativeTime(ago(30 * 86_400_000), now)).toBe(new Date(ago(30 * 86_400_000)).toLocaleDateString());
    expect(relativeTime('', now)).toBe('');
    expect(relativeTime('not a date', now)).toBe('');
  });
});
