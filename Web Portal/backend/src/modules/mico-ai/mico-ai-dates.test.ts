import { describe, it, expect } from 'vitest';
import { dayLabel, parseClock, resolveDay, zonedInstant } from './mico-ai-dates';

// Sat 24 Oct 2026 in Muscat; the company works Sunday to Thursday.
const ctx = { today: '2026-10-24', workingDays: [0, 1, 2, 3, 4] };

describe('MICO AI dates: the words people use, worked out by the server in company time', () => {
  it('reads a calendar date as it is, and refuses one that does not exist', () => {
    expect(resolveDay('2026-10-28', ctx)).toEqual({ day: '2026-10-28' });
    expect(resolveDay(' 2026-11-02 ', ctx)).toEqual({ day: '2026-11-02' });
    expect(resolveDay('2026-02-30', ctx)).toHaveProperty('problem');
    expect(resolveDay('2026-13-01', ctx)).toHaveProperty('problem');
  });

  it('refuses a date years away (a model’s slip, not a plan)', () => {
    expect(resolveDay('2036-10-28', ctx)).toHaveProperty('problem');
    expect(resolveDay('2019-10-28', ctx)).toHaveProperty('problem');
  });

  it('today, tomorrow and the day after', () => {
    expect(resolveDay('today', ctx)).toEqual({ day: '2026-10-24' });
    expect(resolveDay('Tomorrow', ctx)).toEqual({ day: '2026-10-25' });
    expect(resolveDay('the day after tomorrow', ctx)).toEqual({ day: '2026-10-26' });
  });

  it('a weekday is the next one after today ("Tuesday", "on Tue", "next Tuesday")', () => {
    expect(resolveDay('tuesday', ctx)).toEqual({ day: '2026-10-27' });
    expect(resolveDay('on Tue', ctx)).toEqual({ day: '2026-10-27' });
    expect(resolveDay('next Tuesday', ctx)).toEqual({ day: '2026-10-27' });
    // Saturday itself: a week ahead, never today.
    expect(resolveDay('saturday', ctx)).toEqual({ day: '2026-10-31' });
    expect(resolveDay('this saturday', ctx)).toEqual({ day: '2026-10-24' });
    expect(resolveDay('sunday', ctx)).toEqual({ day: '2026-10-25' });
  });

  it('"next week" is the first working day of the next week (Sunday here, Monday for a Monday-to-Friday company)', () => {
    expect(resolveDay('next week', ctx)).toEqual({ day: '2026-10-25' });
    expect(resolveDay('next week', { today: '2026-10-25', workingDays: [0, 1, 2, 3, 4] })).toEqual({ day: '2026-11-01' });
    expect(resolveDay('next week', { today: '2026-10-24', workingDays: [1, 2, 3, 4, 5] })).toEqual({ day: '2026-10-26' });
    // Without the working days: Sunday to Thursday (the company default).
    expect(resolveDay('next week', { today: '2026-10-27' })).toEqual({ day: '2026-11-01' });
  });

  it('"end of the week" is the last working day of this week', () => {
    expect(resolveDay('end of the week', { today: '2026-10-26', workingDays: [0, 1, 2, 3, 4] })).toEqual({ day: '2026-10-29' });
    expect(resolveDay('end of week', ctx)).toEqual({ day: '2026-10-29' });
  });

  it('in N days or weeks', () => {
    expect(resolveDay('in 3 days', ctx)).toEqual({ day: '2026-10-27' });
    expect(resolveDay('in two weeks', ctx)).toEqual({ day: '2026-11-07' });
    expect(resolveDay('in a week', ctx)).toEqual({ day: '2026-10-31' });
    expect(resolveDay('+10', ctx)).toEqual({ day: '2026-11-03' });
    expect(resolveDay('+2w', ctx)).toEqual({ day: '2026-11-07' });
  });

  it('anything else is not guessed: it comes back as a problem', () => {
    const out = resolveDay('sometime soon', ctx);
    expect(out).toHaveProperty('problem');
    expect((out as { problem: string }).problem).toMatch(/sometime soon/);
    expect(resolveDay('', ctx)).toHaveProperty('problem');
  });

  it('times of day: 24-hour, am/pm and noon', () => {
    expect(parseClock('10:00')).toBe('10:00');
    expect(parseClock('9')).toBe('09:00');
    expect(parseClock('9:30 am')).toBe('09:30');
    expect(parseClock('2pm')).toBe('14:00');
    expect(parseClock('12 am')).toBe('00:00');
    expect(parseClock('12:15 PM')).toBe('12:15');
    expect(parseClock('noon')).toBe('12:00');
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('10:75')).toBeNull();
    expect(parseClock('later')).toBeNull();
  });

  it('a day and a time in the company zone become one instant', () => {
    expect(zonedInstant('2026-10-27', '10:00', 'Asia/Muscat').toISOString()).toBe('2026-10-27T06:00:00.000Z');
    expect(zonedInstant('2026-10-27', '00:30', 'Asia/Muscat').toISOString()).toBe('2026-10-26T20:30:00.000Z');
    // A zone with summer time: London is UTC+1 until 25 Oct 2026 and UTC+0 after.
    expect(zonedInstant('2026-10-24', '10:00', 'Europe/London').toISOString()).toBe('2026-10-24T09:00:00.000Z');
    expect(zonedInstant('2026-10-26', '10:00', 'Europe/London').toISOString()).toBe('2026-10-26T10:00:00.000Z');
  });

  it('labels a day with its weekday, so the card shows which Tuesday it is', () => {
    expect(dayLabel('2026-10-27')).toBe('Tue 27 Oct 2026');
  });
});
