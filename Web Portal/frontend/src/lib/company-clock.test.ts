import { describe, it, expect } from 'vitest';
import { formatCompanyClock } from './company-clock';

// 2026-08-08 19:55:00 UTC → in Asia/Muscat (UTC+4) this is 23:55 → "11:55 PM".
const INSTANT = Date.UTC(2026, 7, 8, 19, 55, 0);

describe('formatCompanyClock', () => {
  it('formats in the company time zone as "DD Mon YYYY | hh:mm AM/PM"', () => {
    const c = formatCompanyClock(INSTANT, 'Asia/Muscat');
    expect(c.date).toBe('08 Aug 2026');
    expect(c.time).toBe('11:55 PM');
    expect(c.full).toBe('08 Aug 2026 | 11:55 PM');
  });

  it('uses the company zone, not the device zone (different zones → different clocks)', () => {
    // Same instant, New York (UTC-4 in summer) → 15:55 → 03:55 PM, still Aug 8.
    const ny = formatCompanyClock(INSTANT, 'America/New_York');
    expect(ny.time).toBe('03:55 PM');
    expect(ny.date).toBe('08 Aug 2026');
    // Tokyo (UTC+9) → 04:55 next day.
    const tokyo = formatCompanyClock(INSTANT, 'Asia/Tokyo');
    expect(tokyo.time).toBe('04:55 AM');
    expect(tokyo.date).toBe('09 Aug 2026');
  });

  it('pads the hour to two digits (12-hour)', () => {
    // 2026-08-08 05:05 UTC → Muscat 09:05 AM.
    const c = formatCompanyClock(Date.UTC(2026, 7, 8, 5, 5, 0), 'Asia/Muscat');
    expect(c.time).toBe('09:05 AM');
  });

  it('uses clean 3-letter month names (Sep, not Sept)', () => {
    const c = formatCompanyClock(Date.UTC(2026, 8, 8, 6, 0, 0), 'Asia/Muscat'); // September
    expect(c.date).toBe('08 Sep 2026');
  });

  it('falls back to UTC for an invalid time zone instead of throwing', () => {
    const c = formatCompanyClock(INSTANT, 'Not/AZone');
    expect(c.time).toBe('07:55 PM'); // 19:55 UTC
    expect(c.date).toBe('08 Aug 2026');
  });
});
