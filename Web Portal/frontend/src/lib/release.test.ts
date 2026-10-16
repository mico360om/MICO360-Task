import { describe, it, expect } from 'vitest';
import { formatLastUpdated, isStaleBundle, zoneLabel } from './release';

describe('formatLastUpdated', () => {
  it('writes the time as DD/MM/YYYY, hh:mm AM/PM in Oman time', () => {
    expect(formatLastUpdated('2026-10-16T15:30:00.000Z', 'Asia/Muscat')).toBe('16/10/2026, 07:30 PM (Oman Time)');
    expect(formatLastUpdated('2026-10-16T08:00:00.000Z', 'Asia/Muscat')).toBe('16/10/2026, 12:00 PM (Oman Time)');
    // 00:05 the next day in Muscat.
    expect(formatLastUpdated('2026-10-16T20:05:00.000Z', 'Asia/Muscat')).toBe('17/10/2026, 12:05 AM (Oman Time)');
  });

  it('names another company time zone by its city', () => {
    expect(zoneLabel('Asia/Dubai')).toBe('Dubai time');
    expect(zoneLabel('America/New_York')).toBe('New York time');
    expect(formatLastUpdated('2026-10-16T15:30:00.000Z', 'Europe/London')).toBe('16/10/2026, 04:30 PM (London time)');
  });

  it('says so when there is no time', () => {
    expect(formatLastUpdated('', 'Asia/Muscat')).toBe('—');
    expect(formatLastUpdated('not a date', 'Asia/Muscat')).toBe('—');
  });
});

describe('isStaleBundle', () => {
  const running = { version: '1.0.0', builtAt: '2026-10-16T15:30:00.000Z' };
  it('is true once a newer build has been deployed than the one this page runs', () => {
    expect(isStaleBundle(running, { version: '1.0.0', builtAt: '2026-10-17T09:00:00.000Z' })).toBe(true);
    expect(isStaleBundle(running, { version: '1.1.0', builtAt: '2026-10-17T09:00:00.000Z' })).toBe(true);
  });

  it('is false for the same build, or when the deployed build can’t be read', () => {
    expect(isStaleBundle(running, { ...running })).toBe(false);
    expect(isStaleBundle(running, null)).toBe(false);
    expect(isStaleBundle(running, { version: '1.0.0', builtAt: '' })).toBe(false);
  });
});
