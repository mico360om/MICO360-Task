import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MEETING_REMINDERS,
  draftOf,
  durationText,
  isMeetingReminders,
  readDraft,
  reminderSummary,
  splitMinutes,
} from './meeting-reminder-words';

describe('System Settings → Meeting reminders: words', () => {
  it('the defaults the server uses: on, 24 hours (also by email), 12 hours and 15 minutes', () => {
    expect(DEFAULT_MEETING_REMINDERS).toEqual({
      enabled: true,
      times: [
        { minutes: 1440, email: true },
        { minutes: 720, email: false },
        { minutes: 15, email: false },
      ],
    });
  });

  it('a time as people say it', () => {
    expect(durationText(15)).toBe('15 minutes');
    expect(durationText(1)).toBe('1 minute');
    expect(durationText(60)).toBe('1 hour');
    expect(durationText(720)).toBe('12 hours');
    expect(durationText(1440)).toBe('24 hours');
    expect(durationText(2880)).toBe('2 days');
    expect(durationText(10080)).toBe('7 days');
    expect(durationText(90)).toBe('90 minutes');
  });

  it('the editor shows each time in its largest whole unit (24 hours stays hours, as the owner says it)', () => {
    expect(splitMinutes(15)).toEqual({ amount: 15, unit: 'minutes' });
    expect(splitMinutes(720)).toEqual({ amount: 12, unit: 'hours' });
    expect(splitMinutes(1440)).toEqual({ amount: 24, unit: 'hours' });
    expect(splitMinutes(4320)).toEqual({ amount: 3, unit: 'days' });
    expect(splitMinutes(90)).toEqual({ amount: 90, unit: 'minutes' });
  });

  it('the summary in Current settings', () => {
    expect(reminderSummary(DEFAULT_MEETING_REMINDERS)).toBe('On: 24 hours (also by email), 12 hours and 15 minutes before');
    expect(reminderSummary({ enabled: true, times: [{ minutes: 30, email: false }] })).toBe('On: 30 minutes before');
    expect(reminderSummary({ enabled: false, times: [{ minutes: 30, email: false }] })).toBe('Off');
  });

  it('knows a stored value from a broken one', () => {
    expect(isMeetingReminders(DEFAULT_MEETING_REMINDERS)).toBe(true);
    expect(isMeetingReminders({ enabled: true, times: [{ minutes: '15', email: false }] })).toBe(false);
    expect(isMeetingReminders({ enabled: 'yes', times: [] })).toBe(false);
    expect(isMeetingReminders(null)).toBe(false);
  });

  it('reads the edited times back, longest first — or says what to fix', () => {
    const draft = draftOf(DEFAULT_MEETING_REMINDERS);
    expect(draft).toEqual([
      { amount: '24', unit: 'hours', email: true },
      { amount: '12', unit: 'hours', email: false },
      { amount: '15', unit: 'minutes', email: false },
    ]);
    expect(readDraft([{ amount: '1', unit: 'days', email: false }, ...draft.slice(2)])).toEqual({ ok: true, times: [{ minutes: 1440, email: false }, { minutes: 15, email: false }] });
    expect(readDraft([{ amount: '', unit: 'minutes', email: false }])).toEqual({ ok: false, problem: 'Enter how long before the meeting each reminder goes, as a whole number.' });
    expect(readDraft([{ amount: '2.5', unit: 'hours', email: false }])).toMatchObject({ ok: false });
    expect(readDraft([{ amount: '4', unit: 'minutes', email: false }])).toEqual({ ok: false, problem: 'Each reminder has to be between 5 minutes and 7 days before the meeting.' });
    expect(readDraft([{ amount: '8', unit: 'days', email: false }])).toEqual({ ok: false, problem: 'Each reminder has to be between 5 minutes and 7 days before the meeting.' });
    expect(readDraft([{ amount: '1', unit: 'days', email: false }, { amount: '24', unit: 'hours', email: true }])).toEqual({ ok: false, problem: 'Two reminders are at the same time. Change or remove one.' });
    expect(readDraft([])).toEqual({ ok: false, problem: 'Add at least one reminder time, or switch meeting reminders off.' });
    expect(readDraft(Array.from({ length: 6 }, (_, i) => ({ amount: String(10 + i), unit: 'minutes' as const, email: false })))).toEqual({ ok: false, problem: 'Up to 5 reminder times.' });
  });
});
