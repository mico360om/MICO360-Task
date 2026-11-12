import { describe, it, expect } from 'vitest';
import { reminderWording } from './meeting-reminder-text';

// Sat 31 Oct 2026, 09:00–10:00 in Muscat (GMT+4) = 05:00–06:00 UTC.
const meeting = {
  title: 'Core switch go-live review',
  startAt: new Date('2026-10-31T05:00:00Z'),
  endAt: new Date('2026-10-31T06:00:00Z'),
  location: 'Head office – Meeting room 2',
  onlineLink: 'https://meet.example.com/abc',
};
const MUSCAT = 'Asia/Muscat';
const at = (iso: string) => new Date(iso);

describe('reminderWording: the words of a meeting reminder (bell, phone and email alike)', () => {
  it('15 minutes before: "Meeting in 15 minutes: …", then the time, the place and "Join online"', () => {
    const w = reminderWording({ meeting, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 15, now: at('2026-10-31T04:45:00Z') });
    expect(w.title).toBe('Meeting in 15 minutes: Core switch go-live review');
    expect(w.body).toBe('09:00–10:00 · Head office – Meeting room 2 · Join online');
    expect(w.startsIn).toBe('starts in 15 minutes');
  });

  it('24 hours before: "Meeting tomorrow at 09:00: …" (the day said, in the meeting’s time zone)', () => {
    const w = reminderWording({ meeting, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 1440, now: at('2026-10-30T05:00:00Z') });
    expect(w.title).toBe('Meeting tomorrow at 09:00: Core switch go-live review');
    expect(w.body).toBe('09:00–10:00 · Head office – Meeting room 2 · Join online');
    expect(w.startsIn).toBe('starts tomorrow at 09:00');
  });

  it('12 hours before: "Meeting in 12 hours: …", and the body says it is tomorrow', () => {
    const w = reminderWording({ meeting, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 720, now: at('2026-10-30T17:00:00Z') });
    expect(w.title).toBe('Meeting in 12 hours: Core switch go-live review');
    expect(w.body).toBe('Tomorrow, 09:00–10:00 · Head office – Meeting room 2 · Join online');
    expect(w.startsIn).toBe('starts in 12 hours');
  });

  it('days ahead: the date, "30 Oct 2026" style with the weekday', () => {
    const w = reminderWording({ meeting, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 3 * 1440, now: at('2026-10-28T05:00:00Z') });
    expect(w.title).toBe('Meeting on Sat 31 Oct 2026 at 09:00: Core switch go-live review');
    expect(w.startsIn).toBe('starts on Sat 31 Oct 2026 at 09:00');
  });

  it('a reminder sent a little late says the time that is really left (never more)', () => {
    const w = reminderWording({ meeting, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 15, now: at('2026-10-31T04:46:10Z') });
    expect(w.title).toBe('Meeting in 14 minutes: Core switch go-live review');
    expect(reminderWording({ meeting, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 720, now: at('2026-10-30T17:00:40Z') }).title).toBe('Meeting in 12 hours: Core switch go-live review');
  });

  it('hours and minutes read naturally: 1 minute, 1 hour, 1 hour 30 minutes', () => {
    const title = (offset: number) => reminderWording({ meeting, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: offset, now: new Date(meeting.startAt.getTime() - offset * 60_000) }).title;
    expect(title(5)).toBe('Meeting in 5 minutes: Core switch go-live review');
    expect(title(1)).toBe('Meeting in 1 minute: Core switch go-live review');
    expect(title(60)).toBe('Meeting in 1 hour: Core switch go-live review');
    expect(title(90)).toBe('Meeting in 1 hour 30 minutes: Core switch go-live review');
    expect(title(150)).toBe('Meeting in 2 hours 30 minutes: Core switch go-live review');
  });

  it('someone in another time zone gets their own time in brackets (only when the clock differs)', () => {
    const london = reminderWording({ meeting, meetingZone: MUSCAT, personZone: 'Europe/London', offsetMinutes: 15, now: at('2026-10-31T04:45:00Z') });
    expect(london.body).toBe('09:00–10:00 GMT+4 (05:00–06:00 your time) · Head office – Meeting room 2 · Join online');
    // Dubai keeps Muscat's clock: nothing to add.
    expect(reminderWording({ meeting, meetingZone: MUSCAT, personZone: 'Asia/Dubai', offsetMinutes: 15, now: at('2026-10-31T04:45:00Z') }).body).toBe(
      '09:00–10:00 · Head office – Meeting room 2 · Join online',
    );
    // On their side it is still the day before: the date is said too.
    const honolulu = reminderWording({ meeting, meetingZone: MUSCAT, personZone: 'Pacific/Honolulu', offsetMinutes: 15, now: at('2026-10-31T04:45:00Z') });
    expect(honolulu.body).toBe('09:00–10:00 GMT+4 (30 Oct 2026, 19:00–20:00 your time) · Head office – Meeting room 2 · Join online');
  });

  it('a guest (no zone of their own) gets the meeting’s time only', () => {
    expect(reminderWording({ meeting, meetingZone: MUSCAT, personZone: null, offsetMinutes: 15, now: at('2026-10-31T04:45:00Z') }).body).toBe(
      '09:00–10:00 · Head office – Meeting room 2 · Join online',
    );
  });

  it('a meeting without an end, a place or a link: just its start', () => {
    const bare = { ...meeting, endAt: null, location: null, onlineLink: null };
    expect(reminderWording({ meeting: bare, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 15, now: at('2026-10-31T04:45:00Z') }).body).toBe('09:00');
    expect(reminderWording({ meeting: { ...bare, location: '  ' }, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 15, now: at('2026-10-31T04:45:00Z') }).body).toBe('09:00');
  });

  it('a meeting that ends on the next day keeps the 24-hour clock', () => {
    const late = { ...meeting, startAt: at('2026-10-31T19:30:00Z'), endAt: at('2026-10-31T20:30:00Z') }; // 23:30–00:30 Muscat
    expect(reminderWording({ meeting: late, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 15, now: at('2026-10-31T19:15:00Z') }).body).toBe('23:30–00:30 · Head office – Meeting room 2 · Join online');
  });

  it('the email’s "When": the full day, the time and the meeting’s zone (and theirs when it differs)', () => {
    const now = at('2026-10-30T05:00:00Z');
    expect(reminderWording({ meeting, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: 1440, now }).when).toBe('Sat 31 Oct 2026, 09:00–10:00 (GMT+4)');
    expect(reminderWording({ meeting, meetingZone: MUSCAT, personZone: null, offsetMinutes: 1440, now }).when).toBe('Sat 31 Oct 2026, 09:00–10:00 (GMT+4)');
    expect(reminderWording({ meeting, meetingZone: MUSCAT, personZone: 'Pacific/Honolulu', offsetMinutes: 1440, now }).when).toBe(
      'Sat 31 Oct 2026, 09:00–10:00 (GMT+4) — 30 Oct 2026, 19:00–20:00 your time',
    );
  });

  it('a very long meeting title is shortened, so the headline always fits the bell (191 characters)', () => {
    const long = { ...meeting, title: 'Quarterly '.repeat(19) + 'review' }; // 196 characters
    for (const offset of [15, 720, 3 * 1440]) {
      const w = reminderWording({ meeting: long, meetingZone: MUSCAT, personZone: MUSCAT, offsetMinutes: offset, now: new Date(long.startAt.getTime() - offset * 60_000) });
      expect(w.title.length).toBeLessThanOrEqual(191);
      expect(w.title).toMatch(/^Meeting (in|on) .+: Quarterly Quarterly .+…$/);
    }
  });
});
