import { describe, it, expect } from 'vitest';
import { buildIcs } from './ics';

const base = {
  uid: 'mtg-1@mico360',
  start: new Date('2026-10-05T14:00:00.000Z'),
  end: new Date('2026-10-05T15:00:00.000Z'),
  summary: 'Sprint 12 Review',
  organizer: { name: 'Aisha Khan', email: 'aisha@mico360.test' },
  attendees: [
    { name: 'Khurram Admin', email: 'khurram@mico360.test' },
    { name: 'Jordan Client', email: 'jordan@acme.co', role: 'OPTIONAL' as const },
  ],
};

/** Unfold RFC-5545 folded lines (CRLF + space) so assertions can match logical lines. */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

describe('buildIcs', () => {
  it('produces a valid VCALENDAR/VEVENT envelope with CRLF line endings', () => {
    const ics = buildIcs({ ...base, method: 'REQUEST' });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('\r\n'); // CRLF required by RFC 5545
  });

  it('formats UTC timestamps and core fields', () => {
    const ics = unfold(buildIcs({ ...base, method: 'REQUEST', location: 'Boardroom A', url: 'https://app/meetings/1' }));
    expect(ics).toContain('UID:mtg-1@mico360');
    expect(ics).toContain('DTSTART:20261005T140000Z');
    expect(ics).toContain('DTEND:20261005T150000Z');
    expect(ics).toContain('SUMMARY:Sprint 12 Review');
    expect(ics).toContain('LOCATION:Boardroom A');
    expect(ics).toContain('URL:https://app/meetings/1');
    expect(ics).toContain('ORGANIZER;CN=Aisha Khan:mailto:aisha@mico360.test');
    expect(ics).toContain('ATTENDEE;CN=Khurram Admin;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:khurram@mico360.test');
    expect(ics).toContain('ATTENDEE;CN=Jordan Client;ROLE=OPT-PARTICIPANT;RSVP=TRUE:mailto:jordan@acme.co');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('SEQUENCE:0');
  });

  it('escapes special characters in text fields', () => {
    const ics = unfold(buildIcs({ ...base, method: 'REQUEST', summary: 'Plan; A, B\\C', description: 'Line one\nLine two' }));
    expect(ics).toContain('SUMMARY:Plan\\; A\\, B\\\\C');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('marks a cancellation with METHOD:CANCEL, STATUS:CANCELLED and a bumped sequence', () => {
    const ics = unfold(buildIcs({ ...base, method: 'CANCEL', sequence: 2 }));
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:2');
  });

  it('maps a recurrence rule to an RRULE (weekly with weekdays + count)', () => {
    const ics = unfold(buildIcs({ ...base, method: 'REQUEST', recurrence: { freq: 'WEEKLY', interval: 1, weekdays: [1, 3, 5], count: 10 } }));
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;COUNT=10');
  });

  it('maps QUARTERLY to MONTHLY every 3 months with an UNTIL', () => {
    const ics = unfold(buildIcs({ ...base, method: 'REQUEST', recurrence: { freq: 'QUARTERLY', interval: 1, until: '2027-01-01T00:00:00.000Z' } }));
    expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=3;UNTIL=20270101T000000Z');
  });

  it('anchors a recurring meeting in its time zone so weekdays follow local time', () => {
    // 02:00 Muscat on Monday 5 Oct = 22:00 UTC on Sunday 4 Oct: a UTC DTSTART would move BYDAY to Sunday.
    const ics = unfold(buildIcs({
      ...base,
      method: 'REQUEST',
      start: new Date('2026-10-04T22:00:00.000Z'),
      end: new Date('2026-10-04T23:00:00.000Z'),
      timeZone: 'Asia/Muscat',
      recurrence: { freq: 'WEEKLY', interval: 1, weekdays: [1] },
    }));
    expect(ics).toContain('DTSTART;TZID=Asia/Muscat:20261005T020000');
    expect(ics).toContain('DTEND;TZID=Asia/Muscat:20261005T030000');
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('TZID:Asia/Muscat');
    expect(ics).toContain('TZOFFSETTO:+0400');
    expect(ics.indexOf('END:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'));
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO');
  });

  it('describes daylight-saving zones with yearly STANDARD/DAYLIGHT rules', () => {
    const ics = unfold(buildIcs({ ...base, method: 'REQUEST', timeZone: 'Europe/London', recurrence: { freq: 'WEEKLY', interval: 1 } }));
    expect(ics).toContain('DTSTART;TZID=Europe/London:20261005T150000');
    expect(ics).toMatch(/BEGIN:DAYLIGHT[\s\S]*TZOFFSETFROM:\+0000[\s\S]*TZOFFSETTO:\+0100[\s\S]*RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU/);
    expect(ics).toMatch(/BEGIN:STANDARD[\s\S]*TZOFFSETFROM:\+0100[\s\S]*TZOFFSETTO:\+0000[\s\S]*RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU/);
  });

  it('keeps one-off meetings (and unknown zones) in plain UTC', () => {
    const oneOff = unfold(buildIcs({ ...base, method: 'REQUEST', timeZone: 'Asia/Muscat' }));
    expect(oneOff).toContain('DTSTART:20261005T140000Z');
    expect(oneOff).not.toContain('VTIMEZONE');
    const bad = unfold(buildIcs({ ...base, method: 'REQUEST', timeZone: 'Muscat', recurrence: { freq: 'DAILY', interval: 1 } }));
    expect(bad).toContain('DTSTART:20261005T140000Z');
  });

  it('leaves out a paused recurrence rule', () => {
    const ics = unfold(buildIcs({ ...base, method: 'REQUEST', timeZone: 'Asia/Muscat', recurrence: { freq: 'WEEKLY', interval: 1, paused: true } }));
    expect(ics).not.toContain('RRULE');
    expect(ics).toContain('DTSTART:20261005T140000Z');
  });

  it('folds long lines at 75 octets with CRLF + space', () => {
    const long = 'x'.repeat(200);
    const ics = buildIcs({ ...base, method: 'REQUEST', description: long });
    // every physical line must be <= 75 octets
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    // and unfolding restores the full description
    expect(unfold(ics)).toContain(`DESCRIPTION:${long}`);
  });
});
