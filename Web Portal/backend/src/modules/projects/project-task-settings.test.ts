import { describe, it, expect } from 'vitest';
import { dueDateOnEntry, PROJECT_TASK_DEFAULTS } from './project-task-settings';

const TZ = 'Asia/Muscat'; // UTC+4
// 01:30 on 23 Oct in Muscat — still the 22nd in UTC, so "today" must come from the company zone.
const NOW = new Date('2026-10-22T21:30:00Z');
const dueToday = { defaultDueToday: true };
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe('dueDateOnEntry — "New tasks are due today"', () => {
  it('gives a task without a due date today’s date: the company’s calendar day, stored as due dates are', () => {
    expect(dueDateOnEntry({}, dueToday, TZ, NOW)).toEqual(day('2026-10-23'));
    expect(dueDateOnEntry({ dueDate: null }, dueToday, TZ, NOW)).toEqual(day('2026-10-23'));
  });

  it('always keeps a date someone chose, earlier or later than today', () => {
    expect(dueDateOnEntry({ dueDate: day('2026-11-05') }, dueToday, TZ, NOW)).toEqual(day('2026-11-05'));
    expect(dueDateOnEntry({ dueDate: day('2026-10-01') }, dueToday, TZ, NOW)).toEqual(day('2026-10-01'));
  });

  it('leaves the date alone in a project without the setting (the default for every project)', () => {
    expect(PROJECT_TASK_DEFAULTS.defaultDueToday).toBe(false);
    expect(dueDateOnEntry({}, PROJECT_TASK_DEFAULTS, TZ, NOW)).toBeUndefined();
    expect(dueDateOnEntry({ dueDate: null }, { defaultDueToday: false }, TZ, NOW)).toBeNull();
    expect(dueDateOnEntry({}, null, TZ, NOW)).toBeUndefined();
  });

  it('gives no date to a task that only starts on a later day (it can’t be due before it starts)', () => {
    expect(dueDateOnEntry({ startDate: day('2026-10-25') }, dueToday, TZ, NOW)).toBeUndefined();
    // Starting today (company time) is fine.
    expect(dueDateOnEntry({ startDate: new Date('2026-10-22T21:00:00Z') }, dueToday, TZ, NOW)).toEqual(day('2026-10-23'));
  });
});
