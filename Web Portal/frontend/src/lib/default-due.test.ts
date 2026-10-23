import { describe, it, expect } from 'vitest';
import { defaultDueDay, defaultDueNote } from './default-due';

const TODAY = '2026-10-23'; // a Friday
const dueToday = { defaultDueToday: true };

describe('defaultDueDay — the day the server will give a new undated task', () => {
  it('a later board day, else today; nothing when a date is picked or the project hasn’t got the setting', () => {
    expect(defaultDueDay(dueToday, '', '2026-10-27', TODAY)).toBe('2026-10-27');
    expect(defaultDueDay(dueToday, '', TODAY, TODAY)).toBe(TODAY);
    expect(defaultDueDay(dueToday, '', '2026-10-20', TODAY)).toBe(TODAY); // a past board day: never overdue from the start
    expect(defaultDueDay(dueToday, '', null, TODAY)).toBe(TODAY);
    expect(defaultDueDay(dueToday, '2026-11-05', '2026-10-27', TODAY)).toBeNull();
    expect(defaultDueDay({ defaultDueToday: false }, '', '2026-10-27', TODAY)).toBeNull();
    expect(defaultDueDay(null, '', null, TODAY)).toBeNull();
  });
});

describe('defaultDueNote', () => {
  it('says “today”, or names the day — with the year when it isn’t this year', () => {
    expect(defaultDueNote(TODAY, TODAY)).toBe('Due today (this project’s setting)');
    expect(defaultDueNote('2026-10-27', TODAY)).toBe('Due Tue 27 Oct (this project’s setting)');
    expect(defaultDueNote('2027-01-05', TODAY)).toBe('Due Tue 5 Jan 2027 (this project’s setting)');
  });
});
