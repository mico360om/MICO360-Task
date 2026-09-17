import { describe, it, expect } from 'vitest';
import { lastActiveLabel } from './lastActive';

const now = new Date('2026-09-12T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;

describe('lastActiveLabel', () => {
  it('says "Active now" when online, ignoring the timestamp', () => {
    expect(lastActiveLabel(ago(5 * DAY), true, now)).toBe('Active now');
  });
  it('says "Offline" when never seen and not online', () => {
    expect(lastActiveLabel(null, false, now)).toBe('Offline');
  });
  it('shows just-now / minutes / hours / days for recent activity', () => {
    expect(lastActiveLabel(ago(20_000), false, now)).toBe('Last active just now');
    expect(lastActiveLabel(ago(5 * MIN), false, now)).toBe('Last active 5m ago');
    expect(lastActiveLabel(ago(3 * HR), false, now)).toBe('Last active 3h ago');
    expect(lastActiveLabel(ago(2 * DAY), false, now)).toBe('Last active 2d ago');
  });
  it('falls back to a date for activity older than a week', () => {
    const label = lastActiveLabel(ago(10 * DAY), false, now);
    expect(label.startsWith('Last active on ')).toBe(true);
  });
});
