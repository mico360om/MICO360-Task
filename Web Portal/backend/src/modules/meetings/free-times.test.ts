import { describe, it, expect } from 'vitest';
import { findClashes, suggestTimes, type BusyBlock } from './free-times';
import { DEFAULT_WORKING_HOURS } from '../settings/settings-service';

const TZ = 'Asia/Muscat'; // UTC+4, no daylight saving
/** A Muscat wall-clock time as an instant: "2026-10-26 08:10" → 04:10Z. */
const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00+04:00`);
const iso = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
const busy = (userId: string, from: string, to: string, title: string | null = 'Site walk'): BusyBlock => ({ userId, start: at(from), end: at(to), meetingId: `m-${from}`, title });

// 26 Oct 2026 is a Monday.
describe('suggestTimes', () => {
  it('suggests the three nearest free 30-minute-aligned slots inside working hours', () => {
    const out = suggestTimes({ from: at('2026-10-26 08:10'), minutes: 60, busy: [busy('u1', '2026-10-26 08:30', '2026-10-26 10:00')], hours: DEFAULT_WORKING_HOURS, timeZone: TZ });
    expect(out.map(iso)).toEqual(['2026-10-26 10:00', '2026-10-26 10:30', '2026-10-26 11:00']);
  });

  it('never offers a time on a non-working day or ending after the day ends', () => {
    // Thursday 29 Oct from 16:10: 16:30 + 60 min would end after 17:00; Fri and Sat are off.
    const out = suggestTimes({ from: at('2026-10-29 16:10'), minutes: 60, busy: [], hours: DEFAULT_WORKING_HOURS, timeZone: TZ });
    expect(out.map(iso)).toEqual(['2026-11-01 08:00', '2026-11-01 08:30', '2026-11-01 09:00']);
  });

  it('keeps a weekly repeat on its weekdays', () => {
    const out = suggestTimes({ from: at('2026-10-27 09:00'), minutes: 30, busy: [], hours: DEFAULT_WORKING_HOURS, timeZone: TZ, rule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
    expect(out.map(iso)).toEqual(['2026-11-02 08:00', '2026-11-02 08:30', '2026-11-02 09:00']); // the next Monday
  });

  it('keeps a daily repeat on working days', () => {
    const out = suggestTimes({ from: at('2026-10-30 09:00'), minutes: 30, busy: [], hours: DEFAULT_WORKING_HOURS, timeZone: TZ, rule: { freq: 'DAILY', interval: 1 } });
    expect(iso(out[0]!)).toBe('2026-11-01 08:00'); // Friday 30 Oct is off
  });

  it('only counts a slot free when no one invited is busy', () => {
    const out = suggestTimes({
      from: at('2026-10-26 08:00'),
      minutes: 30,
      busy: [busy('u1', '2026-10-26 08:00', '2026-10-26 09:00'), busy('u2', '2026-10-26 09:00', '2026-10-26 09:30')],
      hours: DEFAULT_WORKING_HOURS,
      timeZone: TZ,
    });
    expect(out.map(iso)).toEqual(['2026-10-26 09:30', '2026-10-26 10:00', '2026-10-26 10:30']);
  });

  it('stops after 14 days', () => {
    const allBusy = Array.from({ length: 20 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10);
      return busy('u1', `${d} 00:00`, `${d} 23:59`);
    });
    expect(suggestTimes({ from: at('2026-10-26 08:00'), minutes: 60, busy: allBusy, hours: DEFAULT_WORKING_HOURS, timeZone: TZ })).toEqual([]);
  });
});

describe('findClashes', () => {
  it('names the person and the date', () => {
    const out = findClashes({ start: at('2026-10-26 09:30'), minutes: 60, busy: [busy('u2', '2026-10-26 10:00', '2026-10-26 11:00', null), busy('u1', '2026-10-26 11:00', '2026-10-26 12:00')], timeZone: TZ });
    expect(out).toEqual([{ userId: 'u2', date: '2026-10-26', start: at('2026-10-26 10:00'), end: at('2026-10-26 11:00'), title: null }]);
  });

  it('checks the first 4 meetings of a repeat', () => {
    const blocks = [busy('u1', '2026-11-09 10:00', '2026-11-09 10:30'), busy('u1', '2026-11-23 10:00', '2026-11-23 10:30')];
    const out = findClashes({ start: at('2026-10-26 10:00'), minutes: 60, busy: blocks, timeZone: TZ, rule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
    // Mondays 26 Oct, 2, 9 and 16 Nov are checked; 23 Nov is the 5th meeting.
    expect(out.map((c) => c.date)).toEqual(['2026-11-09']);
  });
});
