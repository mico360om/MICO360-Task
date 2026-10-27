import { describe, it, expect } from 'vitest';
import { defaultScheduleName, dueText, upcomingText, firstCheckDay, lateText, presetOf, presetRule, scheduleSentence } from './inspection-schedule';

const SUN_THU = [0, 1, 2, 3, 4];

describe('the schedule’s name', () => {
  it('is “<form> – <place>”, or the form alone', () => {
    expect(defaultScheduleName('Rig daily check', 'Rig 3')).toBe('Rig daily check – Rig 3');
    expect(defaultScheduleName('Rig daily check', '  ')).toBe('Rig daily check');
    expect(defaultScheduleName('فحص يومي', 'الحفار ٣')).toBe('فحص يومي – الحفار ٣');
    expect(defaultScheduleName('', 'Rig 3')).toBe('');
  });
});

describe('repeat presets', () => {
  it('every day, every working day, weekly on the start’s weekday, monthly on its day — all on schedule', () => {
    // 28 Oct 2026 is a Wednesday.
    expect(presetRule('DAILY', '2026-10-28', SUN_THU)).toEqual({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' });
    expect(presetRule('WORKING_DAYS', '2026-10-28', SUN_THU)).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: SUN_THU, createNext: 'ON_SCHEDULE' });
    expect(presetRule('WEEKLY', '2026-10-28', SUN_THU)).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [3], createNext: 'ON_SCHEDULE' });
    expect(presetRule('MONTHLY', '2026-10-28', SUN_THU)).toEqual({ freq: 'MONTHLY', interval: 1, dayOfMonth: 28, createNext: 'ON_SCHEDULE' });
  });

  it('names a rule back (an edit opens on its preset); anything else is custom', () => {
    expect(presetOf({ freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' }, SUN_THU)).toBe('DAILY');
    expect(presetOf({ freq: 'WEEKLY', interval: 1, weekdays: [4, 0, 1, 2, 3], createNext: 'ON_SCHEDULE', count: 20 }, SUN_THU)).toBe('WORKING_DAYS');
    expect(presetOf({ freq: 'WEEKLY', interval: 1, weekdays: [1, 3] }, SUN_THU)).toBe('WEEKLY');
    expect(presetOf({ freq: 'MONTHLY', interval: 1, dayOfMonth: 5 }, SUN_THU)).toBe('MONTHLY');
    expect(presetOf({ freq: 'DAILY', interval: 2 }, SUN_THU)).toBe('CUSTOM');
    expect(presetOf({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } }, SUN_THU)).toBe('CUSTOM');
    expect(presetOf({ freq: 'YEARLY', interval: 1 }, SUN_THU)).toBe('CUSTOM');
  });
});

describe('the first check’s day', () => {
  it('is the start day when it is on the schedule, else the first scheduled day after it', () => {
    const working = presetRule('WORKING_DAYS', '2026-10-30', SUN_THU);
    expect(firstCheckDay('2026-10-28', working)).toBe('2026-10-28'); // a Wednesday
    expect(firstCheckDay('2026-10-30', working)).toBe('2026-11-01'); // Friday → Sunday
    expect(firstCheckDay('2026-10-30', { freq: 'DAILY', interval: 3 })).toBe('2026-10-30');
    expect(firstCheckDay('2026-10-28', { freq: 'MONTHLY', interval: 1, dayOfMonth: 5 })).toBe('2026-11-05');
    expect(firstCheckDay('2026-10-03', { freq: 'MONTHLY', interval: 1, dayOfMonth: 5 })).toBe('2026-10-05');
    expect(firstCheckDay('2026-10-28', { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } })).toBe('2026-10-30'); // the last Friday
    expect(firstCheckDay('2026-10-28', { freq: 'WEEKLY', interval: 1 })).toBe('2026-10-28');
  });
});

describe('the plain-English line under Repeat', () => {
  it('says how often, that each is due on its day, and for whom', () => {
    expect(scheduleSentence(presetRule('WORKING_DAYS', '2026-10-28', SUN_THU), ['Ali', 'Sara'], SUN_THU, '2026-10-28')).toBe('A check is created every working day, due that day, for Ali and Sara. The first one is due on Wed 28 Oct.');
    expect(scheduleSentence({ freq: 'DAILY', interval: 1 }, ['Ali'], SUN_THU, '2026-10-28')).toBe('A check is created every day, due that day, for Ali. The first one is due on Wed 28 Oct.');
    expect(scheduleSentence({ freq: 'DAILY', interval: 2, count: 5 }, ['Ali', 'Sara', 'Omar'], SUN_THU, '2026-10-28')).toBe('A check is created every 2 days, 5 times, due that day, for Ali, Sara and Omar. The first one is due on Wed 28 Oct.');
    expect(scheduleSentence({ freq: 'WEEKLY', interval: 1, weekdays: [1, 4] }, ['Ali'], SUN_THU, '2026-11-02')).toBe('A check is created every Monday and Thursday, due that day, for Ali. The first one is due on Mon 2 Nov.');
    expect(scheduleSentence({ freq: 'WEEKLY', interval: 2, weekdays: [1], until: '2026-12-31' }, ['Ali'], SUN_THU, '2026-11-02')).toBe('A check is created every 2 weeks on Monday, until Thu 31 Dec, due that day, for Ali. The first one is due on Mon 2 Nov.');
    expect(scheduleSentence({ freq: 'MONTHLY', interval: 1, dayOfMonth: 5 }, ['Ali'], SUN_THU, '2026-11-05')).toBe('A check is created on day 5 of every month, due that day, for Ali. The first one is due on Thu 5 Nov.');
    expect(scheduleSentence({ freq: 'MONTHLY', interval: 1, dayOfMonth: 31 }, ['Ali'], SUN_THU, '2026-11-30')).toBe('A check is created on the last day of every month, due that day, for Ali. The first one is due on Mon 30 Nov.');
    expect(scheduleSentence({ freq: 'MONTHLY', interval: 3, nthWeekday: { week: 2, day: 2 } }, ['Ali'], SUN_THU, '2026-11-10')).toBe('A check is created on the 2nd Tuesday of every 3 months, due that day, for Ali. The first one is due on Tue 10 Nov.');
    expect(scheduleSentence({ freq: 'YEARLY', interval: 1 }, ['Ali'], SUN_THU, '2026-11-10')).toBe('A check is created every year, due that day, for Ali. The first one is due on Tue 10 Nov.');
  });
  it('asks for an inspector when nobody is picked, and leaves out the first day on an edit', () => {
    expect(scheduleSentence({ freq: 'DAILY', interval: 1 }, [], SUN_THU, '2026-10-28')).toBe('A check is created every day, due that day. Pick at least one inspector.');
    expect(scheduleSentence({ freq: 'DAILY', interval: 1 }, ['Ali'], SUN_THU, null)).toBe('A check is created every day, due that day, for Ali.');
  });
});

describe('how a due check’s day reads', () => {
  it('says how late, or when it is due', () => {
    expect(lateText(1)).toBe('1 day late');
    expect(lateText(3)).toBe('3 days late');
    expect(dueText('2026-10-28', '2026-10-28')).toBe('Due today');
    expect(dueText('2026-10-29', '2026-10-28')).toBe('Due tomorrow');
    expect(dueText('2026-11-02', '2026-10-28')).toBe('Due Mon 2 Nov');
    expect(dueText(null, '2026-10-28')).toBe('No due date');
  });
  it('an upcoming check (not due yet) reads as its day', () => {
    expect(upcomingText('2026-10-29', '2026-10-28')).toBe('Tomorrow');
    expect(upcomingText('2026-11-02', '2026-10-28')).toBe('Mon 2 Nov');
    expect(upcomingText(null, '2026-10-28')).toBe('No due date');
  });
});
