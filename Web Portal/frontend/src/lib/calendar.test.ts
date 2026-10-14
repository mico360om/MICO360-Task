import { describe, it, expect } from 'vitest';
import { groupTasksByDueDate, monthGrid, monthWeeks, visibleRange, weekDays, weekdayLabels, shiftMonth, monthOf } from './calendar';
import type { ApiTask } from '../api/tasks';

const dow = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
const consecutive = (keys: string[]) =>
  keys.every((k, i) => i === 0 || new Date(`${k}T00:00:00Z`).getTime() - new Date(`${keys[i - 1]}T00:00:00Z`).getTime() === 86400000);

const base: Omit<ApiTask, 'id' | 'key' | 'dueDate'> = {
  title: 't',
  description: null,
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  progress: 0,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
};

describe('groupTasksByDueDate', () => {
  it('groups by day, sorted, excluding tasks with no due date', () => {
    const tasks: ApiTask[] = [
      { ...base, id: '1', key: 'A', dueDate: '2026-06-15T09:00:00Z' },
      { ...base, id: '2', key: 'B', dueDate: '2026-06-14T09:00:00Z' },
      { ...base, id: '3', key: 'C', dueDate: null },
      { ...base, id: '4', key: 'D', dueDate: '2026-06-15T18:00:00Z' },
    ];
    const groups = groupTasksByDueDate(tasks);
    expect(groups.map((g) => g.date)).toEqual(['2026-06-14', '2026-06-15']);
    expect(groups[1]!.tasks).toHaveLength(2);
  });
});

describe('monthGrid', () => {
  it('builds a 6×7 grid of consecutive days, Sunday-first, flagging in-month days', () => {
    const weeks = monthGrid(2026, 8); // September 2026 (month index 8)
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);

    const flat = weeks.flat();
    expect(dow(flat[0]!.key)).toBe(0); // starts on a Sunday
    expect(consecutive(flat.map((c) => c.key))).toBe(true); // 42 consecutive days

    const sep1 = flat.find((c) => c.key === '2026-09-01')!;
    expect(sep1.day).toBe(1);
    expect(sep1.inMonth).toBe(true);

    // every September day is present and in-month; a trailing/leading day is out-of-month
    for (let d = 1; d <= 30; d++) {
      const key = `2026-09-${String(d).padStart(2, '0')}`;
      expect(flat.find((c) => c.key === key)?.inMonth).toBe(true);
    }
    expect(flat.some((c) => !c.inMonth)).toBe(true);
  });
});

describe('weekDays', () => {
  it('returns the 7 consecutive days of the week (Sunday-first) containing the date', () => {
    const days = weekDays('2026-09-09'); // a Wednesday
    expect(days).toHaveLength(7);
    expect(dow(days[0]!)).toBe(0);
    expect(consecutive(days)).toBe(true);
    expect(days).toContain('2026-09-09');
  });
});

describe('shiftMonth', () => {
  it('steps to the 1st of the next/previous month even from the 29th–31st (no skipped months)', () => {
    expect(shiftMonth('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftMonth('2026-01-29', 1)).toBe('2026-02-01');
    expect(shiftMonth('2026-03-31', -1)).toBe('2026-02-01');
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01');
  });

  it('reads the year and month of a key', () => {
    expect(monthOf('2026-11-01')).toEqual({ year: 2026, month0: 10 });
  });
});

describe('groupTasksByDueDate in the company zone', () => {
  it('keeps a date-only (UTC-midnight) due date on its own day in any zone', () => {
    const t: ApiTask = { ...base, id: '1', key: 'A', dueDate: '2026-09-30T00:00:00.000Z' };
    expect(groupTasksByDueDate([t], 'America/New_York')[0]!.date).toBe('2026-09-30');
    expect(groupTasksByDueDate([t], 'Asia/Muscat')[0]!.date).toBe('2026-09-30');
  });
});

describe('week start (Sunday, Monday or Saturday)', () => {
  it('starts the month grid and the week on the chosen day', () => {
    expect(monthGrid(2026, 9, 1)[0]![0]!.key).toBe('2026-09-28'); // Monday before 1 Oct (a Thursday)
    expect(monthGrid(2026, 9, 6)[0]![0]!.key).toBe('2026-09-26'); // Saturday
    expect(weekDays('2026-10-10', 1)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(weekDays('2026-10-10', 6)[0]).toBe('2026-10-10');
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(6)[0]).toBe('Sat');
  });

  it('shows only the weeks that touch the month (no empty rows)', () => {
    const weeks = monthWeeks(2026, 1, 0); // February 2026: Sun 1 – Sat 28, exactly 4 weeks
    expect(weeks).toHaveLength(4);
    expect(monthWeeks(2026, 9, 0)).toHaveLength(5); // October 2026
    expect(monthWeeks(2026, 7, 0)).toHaveLength(6); // August 2026 (starts on a Saturday)
  });
});

describe('visibleRange — what each view asks the server for', () => {
  it('month: the grid’s first to last day; week: its 7 days; agenda: the month', () => {
    expect(visibleRange('month', '2026-10-10', 0)).toEqual({ from: '2026-09-27', to: '2026-10-31' });
    expect(visibleRange('month', '2026-10-10', 1)).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(visibleRange('week', '2026-10-10', 0)).toEqual({ from: '2026-10-04', to: '2026-10-10' });
    expect(visibleRange('agenda', '2026-10-10', 0)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    // Across a year boundary.
    expect(visibleRange('week', '2026-12-31', 1)).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });
});
