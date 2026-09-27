import { describe, it, expect } from 'vitest';
import {
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
    expect(label).toMatch(/10:00/);
    expect(label).toMatch(/11:00/);
    expect(label).not.toMatch(/6:00/);
  });

  it('handles a missing or invalid end', () => {
    expect(formatMeetingRange('2026-10-01T06:00:00Z', null, MUSCAT)).toMatch(/10:00/);
    expect(formatMeetingRange('bad', null, MUSCAT)).toBe('');
  });
});

describe('due dates are calendar days', () => {
  it('labels a UTC-midnight due date with its own day', () => {
    expect(formatDueDate('2026-09-30T00:00:00.000Z', MUSCAT)).toMatch(/30/);
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
