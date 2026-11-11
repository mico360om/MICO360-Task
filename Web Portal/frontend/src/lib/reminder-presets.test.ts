import { describe, it, expect } from 'vitest';
import { describeReminder, localInputToIso, offsetWords, reminderChoices } from './reminder-presets';

const TZ = 'Asia/Muscat';

describe('“Remind me” choices (owner 3: a date and time, or a time before the start or due)', () => {
  it('a date-only due day: that morning, a day, two days or a week before; a start adds its own', () => {
    expect(reminderChoices({ startDate: '2026-11-15', dueDate: '2026-11-20' }, TZ).map((c) => c.label)).toEqual([
      'On the morning it’s due',
      '1 day before it’s due',
      '2 days before it’s due',
      '1 week before it’s due',
      'On the morning it starts',
      '1 day before it starts',
    ]);
    expect(reminderChoices({ startDate: null, dueDate: '2026-11-20' }, TZ)[1]!.timing).toEqual({ anchor: 'due', offsetMinutes: 1440 });
  });

  it('a due time: 15 minutes, an hour, two hours or a day before it', () => {
    expect(reminderChoices({ startDate: null, dueDate: '2026-11-20T10:30:00.000Z' }, TZ).map((c) => [c.label, c.timing])).toEqual([
      ['15 minutes before it’s due', { anchor: 'due', offsetMinutes: 15 }],
      ['1 hour before it’s due', { anchor: 'due', offsetMinutes: 60 }],
      ['2 hours before it’s due', { anchor: 'due', offsetMinutes: 120 }],
      ['1 day before it’s due', { anchor: 'due', offsetMinutes: 1440 }],
    ]);
    expect(reminderChoices({ startDate: null, dueDate: null }, TZ)).toEqual([]);
  });

  it('says when, in plain words', () => {
    expect(offsetWords('due', 0, false)).toBe('On the morning it’s due');
    expect(offsetWords('due', 0, true)).toBe('When it’s due');
    expect(offsetWords('start', 2880, false)).toBe('2 days before it starts');
    expect(offsetWords('due', 90, true)).toBe('1 h 30 min before it’s due');
    expect(describeReminder({ at: null, anchor: 'due', offsetMinutes: 1440, fireAt: '2026-11-19T04:00:00.000Z' }, TZ, false)).toBe('1 day before it’s due · Thu 19 Nov, 08:00');
    expect(describeReminder({ at: '2026-11-13T10:00:00.000Z', anchor: null, offsetMinutes: null, fireAt: '2026-11-13T10:00:00.000Z' }, TZ, false)).toBe('Fri 13 Nov, 14:00');
  });

  it('a date and time typed in the calendar’s zone becomes the instant it means', () => {
    expect(localInputToIso('2026-11-13T14:00', TZ)).toBe('2026-11-13T10:00:00.000Z');
    expect(localInputToIso('nonsense', TZ)).toBeNull();
  });
});
