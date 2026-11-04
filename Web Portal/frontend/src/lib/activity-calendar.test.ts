import { describe, it, expect } from 'vitest';
import { calendarPeriod, changesText, periodText, shadeStep, stepCursor, ACTIVITY_VIEW_PREF, ACTIVITY_PERIOD_PREF } from './activity-calendar';

describe('the Activity calendar’s days', () => {
  it('a month shows its whole weeks, starting on the week start (Sunday)', () => {
    const p = calendarPeriod('month', '2026-11-04', 0);
    expect(p.from).toBe('2026-11-01');
    expect(p.to).toBe('2026-12-05');
    expect(p.weeks).toHaveLength(5);
    expect(p.weeks[0]!.map((d) => d.key)[0]).toBe('2026-11-01');
    expect(p.weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
  });

  it('a month starting on Monday or Saturday lines up with that day', () => {
    expect(calendarPeriod('month', '2026-11-04', 1).from).toBe('2026-10-26');
    expect(calendarPeriod('month', '2026-11-04', 6).from).toBe('2026-10-31');
  });

  it('a week is the seven days around the day, from the week start', () => {
    const p = calendarPeriod('week', '2026-11-04', 1);
    expect(p.from).toBe('2026-11-02');
    expect(p.to).toBe('2026-11-08');
    expect(p.weeks).toHaveLength(1);
    expect(p.weeks[0]!.every((d) => d.inMonth)).toBe(true);
  });

  it('Previous and Next move a month or a week', () => {
    expect(stepCursor('month', '2026-11-30', 1)).toBe('2026-12-01');
    expect(stepCursor('month', '2026-01-15', -1)).toBe('2025-12-01');
    expect(stepCursor('week', '2026-11-04', 1)).toBe('2026-11-11');
    expect(stepCursor('week', '2026-11-04', -1)).toBe('2026-10-28');
  });
});

describe('how busy a day looks', () => {
  it('four steps from quiet to busy, against the busiest day shown; none for a day with no changes', () => {
    expect(shadeStep(0, 20)).toBe(0);
    expect(shadeStep(1, 20)).toBe(1);
    expect(shadeStep(5, 20)).toBe(1);
    expect(shadeStep(6, 20)).toBe(2);
    expect(shadeStep(15, 20)).toBe(3);
    expect(shadeStep(16, 20)).toBe(4);
    expect(shadeStep(20, 20)).toBe(4);
    // One change all month is a busy day for that month.
    expect(shadeStep(1, 1)).toBe(4);
    expect(shadeStep(0, 0)).toBe(0);
  });
});

describe('the calendar’s words', () => {
  it('names the period: the month, or the week’s days (day before month, no commas)', () => {
    expect(periodText('month', '2026-11-04', 0)).toBe('November 2026');
    expect(periodText('week', '2026-11-04', 1)).toBe('2 – 8 Nov 2026');
    expect(periodText('week', '2026-12-02', 1)).toBe('30 Nov – 6 Dec 2026');
    expect(periodText('week', '2026-12-30', 1)).toBe('28 Dec 2026 – 3 Jan 2027');
  });

  it('counts changes in plain words', () => {
    expect(changesText(0)).toBe('No changes');
    expect(changesText(1)).toBe('1 change');
    expect(changesText(12)).toBe('12 changes');
  });

  it('remembers the view and the period under the person’s own names', () => {
    expect(ACTIVITY_VIEW_PREF).toBe('activity.view');
    expect(ACTIVITY_PERIOD_PREF).toBe('activity.calendar');
  });
});
