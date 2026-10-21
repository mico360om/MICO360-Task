import { describe, it, expect } from 'vitest';
import { dateFormat } from './intl-cache';

describe('dateFormat (one formatter per locale, zone and options)', () => {
  it('hands back the same formatter for the same settings, whatever the order of the options', () => {
    const a = dateFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Muscat' });
    const b = dateFormat('en-GB', { timeZone: 'Asia/Muscat', minute: '2-digit', hourCycle: 'h23', hour: '2-digit' });
    expect(a).toBe(b);
    expect(a.format(new Date('2026-10-20T06:05:00.000Z'))).toBe('10:05');
  });

  it('keeps different settings apart (the device locale included)', () => {
    const muscat = dateFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' });
    const utc = dateFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    expect(muscat).not.toBe(utc);
    expect(dateFormat(undefined, { month: 'short' })).not.toBe(dateFormat('en-GB', { month: 'short' }));
    expect(muscat.format(new Date('2026-10-19T22:30:00.000Z'))).toBe('2026-10-20');
  });
});
