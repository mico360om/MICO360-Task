import { describe, it, expect } from 'vitest';
import {
  formatClockTime,
  formatDueDate,
  formatMeetingRange,
  fromLocalInputValue,
  isActionItemOverdue,
  nextHourInputValue,
  normalizeMeetingLink,
  safeMeetingHref,
  toLocalInputValue,
} from './meetingFormat';

const MUSCAT = 'Asia/Muscat'; // UTC+4, no DST

describe('datetime-local values in the company time zone', () => {
  it('reads a typed wall-clock time as company time, whatever the device zone', () => {
    // 10:00 in Muscat is 06:00 UTC.
    expect(fromLocalInputValue('2026-10-01T10:00', MUSCAT)).toBe('2026-10-01T06:00:00.000Z');
  });

  it('shows a stored instant as company wall-clock time', () => {
    expect(toLocalInputValue('2026-10-01T06:00:00.000Z', MUSCAT)).toBe('2026-10-01T10:00');
  });

  it('round-trips across a DST change in a zone that has one', () => {
    const tz = 'Europe/London';
    for (const v of ['2026-03-29T00:30', '2026-03-29T03:15', '2026-10-25T12:00', '2026-07-01T09:45']) {
      expect(toLocalInputValue(fromLocalInputValue(v, tz), tz)).toBe(v);
    }
  });

  it('returns null / empty for bad input', () => {
    expect(fromLocalInputValue('', MUSCAT)).toBeNull();
    expect(fromLocalInputValue('not a date', MUSCAT)).toBeNull();
    expect(toLocalInputValue('garbage', MUSCAT)).toBe('');
    expect(toLocalInputValue(null, MUSCAT)).toBe('');
  });

  it('defaults a new meeting to the next full hour in company time', () => {
    const now = new Date('2026-10-01T05:25:00Z'); // 09:25 in Muscat
    expect(nextHourInputValue(MUSCAT, now)).toBe('2026-10-01T10:00');
  });
});

describe('formatMeetingRange', () => {
  it('formats the times in the company zone', () => {
    const label = formatMeetingRange('2026-10-01T06:00:00Z', '2026-10-01T07:00:00Z', MUSCAT);
    // Day before month and the 24-hour clock, whatever the browser's language.
    expect(label).toBe('Thu 1 Oct · 10:00 – 11:00');
    expect(formatMeetingRange('2026-10-01T10:00:00Z', '2026-10-01T22:30:00Z', MUSCAT)).toBe('Thu 1 Oct 14:00 – Fri 2 Oct 02:30');
  });

  it('handles a missing or invalid end', () => {
    expect(formatMeetingRange('2026-10-01T06:00:00Z', null, MUSCAT)).toMatch(/10:00/);
    expect(formatMeetingRange('bad', null, MUSCAT)).toBe('');
  });
});

describe('due dates are calendar days', () => {
  it('labels a UTC-midnight due date with its own day', () => {
    expect(formatDueDate('2026-09-30T00:00:00.000Z', MUSCAT)).toBe('30 Sep');
    expect(formatDueDate(null)).toBe('');
  });

  it('is not overdue on its due day, even after 04:00 Muscat time', () => {
    const item = { dueDate: '2026-09-30T00:00:00.000Z', status: 'OPEN' as const };
    expect(isActionItemOverdue(item, MUSCAT, new Date('2026-09-30T05:00:00Z'))).toBe(false); // 09:00 on the 30th
    expect(isActionItemOverdue(item, MUSCAT, new Date('2026-09-30T20:30:00Z'))).toBe(true); // 00:30 on Oct 1 in Muscat
  });

  it('never marks finished action items overdue', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    expect(isActionItemOverdue({ dueDate: '2026-09-30T00:00:00.000Z', status: 'COMPLETED' }, MUSCAT, now)).toBe(false);
    expect(isActionItemOverdue({ dueDate: '2026-09-30T00:00:00.000Z', status: 'CANCELLED' }, MUSCAT, now)).toBe(false);
    expect(isActionItemOverdue({ dueDate: null, status: 'OPEN' }, MUSCAT, now)).toBe(false);
  });
});

describe('normalizeMeetingLink', () => {
  it('adds https:// when no scheme is given', () => {
    expect(normalizeMeetingLink('meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(normalizeMeetingLink('  zoom.us/j/123 ')).toBe('https://zoom.us/j/123');
  });

  it('keeps http(s) links', () => {
    expect(normalizeMeetingLink('https://teams.microsoft.com/l/meetup')).toBe('https://teams.microsoft.com/l/meetup');
    expect(normalizeMeetingLink('http://intranet.example.com/room')).toBe('http://intranet.example.com/room');
  });

  it('treats an empty value as no link', () => {
    expect(normalizeMeetingLink('')).toBeNull();
    expect(normalizeMeetingLink('   ')).toBeNull();
  });

  it('rejects script, data and other non-web links', () => {
    expect(normalizeMeetingLink('javascript:alert(1)')).toBeUndefined();
    expect(normalizeMeetingLink('JavaScript:alert(1)')).toBeUndefined();
    expect(normalizeMeetingLink('data:text/html,hi')).toBeUndefined();
    expect(normalizeMeetingLink('ftp://files.example.com')).toBeUndefined();
    expect(normalizeMeetingLink('not a link')).toBeUndefined();
  });

  it('never produces an unsafe href for stored data', () => {
    expect(safeMeetingHref('javascript:alert(1)')).toBeNull();
    expect(safeMeetingHref('meet.google.com/abc')).toBe('https://meet.google.com/abc');
    expect(safeMeetingHref(null)).toBeNull();
  });
});

describe('meeting list day and times', () => {
  it('shows the day and the start–end times in the given zone', async () => {
    const { formatMeetingDay, formatMeetingTimes } = await import('./meetingFormat');
    // Day before month and the 24-hour clock (whatever the browser's language); the zone decides the day and the hour.
    const tz = 'Asia/Muscat';
    expect(formatMeetingDay('2026-10-01T06:00:00.000Z', tz)).toBe('Thu 1 Oct');
    // 22:00 UTC is already the next day in Muscat.
    expect(formatMeetingDay('2026-10-01T22:00:00.000Z', tz)).toBe('Fri 2 Oct');
    expect(formatMeetingTimes('2026-10-01T06:00:00.000Z', '2026-10-01T07:30:00.000Z', tz)).toBe('10:00 – 11:30');
    expect(formatMeetingTimes('2026-10-01T06:00:00.000Z', null, tz)).toBe('10:00');
    // Ends on another day: say which.
    expect(formatMeetingTimes('2026-10-01T18:00:00.000Z', '2026-10-02T06:00:00.000Z', tz)).toBe('22:00 – Fri 2 Oct 10:00');
    expect(formatClockTime('2026-10-01T09:14:00.000Z', tz)).toBe('13:14');
  });
});
