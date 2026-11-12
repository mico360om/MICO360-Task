import { describe, it, expect } from 'vitest';
import { MAX_SPAN_DAYS, shownBySpan, spanOf } from './calendar-span';

const TZ = 'Asia/Muscat';
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

describe('a task across the calendar: from its start to its due day (owner, 11 Nov)', () => {
  it('a task with a start and a due date runs from one to the other', () => {
    expect(spanOf({ startDate: day('2026-11-03'), dueDate: day('2026-11-06') }, TZ)).toEqual({ start: '2026-11-03', due: '2026-11-06', mode: 'bar' });
  });

  it('a due-only task stays on its due day; a start on or after the due day reads as due-only', () => {
    expect(spanOf({ startDate: null, dueDate: day('2026-11-06') }, TZ)).toEqual({ start: null, due: '2026-11-06', mode: 'due' });
    expect(spanOf({ startDate: day('2026-11-06'), dueDate: day('2026-11-06') }, TZ)).toEqual({ start: null, due: '2026-11-06', mode: 'due' });
    expect(spanOf({ startDate: day('2026-11-09'), dueDate: day('2026-11-06') }, TZ)).toEqual({ start: null, due: '2026-11-06', mode: 'due' });
  });

  it('a start without a due date shows its start mark only', () => {
    expect(spanOf({ startDate: day('2026-11-03'), dueDate: null }, TZ)).toEqual({ start: '2026-11-03', due: null, mode: 'start' });
    expect(spanOf({ startDate: null, dueDate: null }, TZ)).toBeNull();
  });

  it('over three weeks: only the start and due marks (no bar)', () => {
    expect(MAX_SPAN_DAYS).toBe(21);
    expect(spanOf({ startDate: day('2026-11-01'), dueDate: day('2026-11-22') }, TZ)!.mode).toBe('bar'); // 21 days
    expect(spanOf({ startDate: day('2026-11-01'), dueDate: day('2026-11-23') }, TZ)!.mode).toBe('markers'); // 22 days
  });

  it('only a start someone chose (a day) draws a bar: the automatic one — the moment the task was made — does not', () => {
    // The server fills an unchosen start with the creation time (an instant): such a task is due-only.
    expect(spanOf({ startDate: new Date('2026-11-02T22:13:41.512Z'), dueDate: day('2026-11-05') }, TZ)).toEqual({ start: null, due: '2026-11-05', mode: 'due' });
    expect(spanOf({ startDate: new Date('2026-11-02T09:00:00.000Z'), dueDate: null }, TZ)).toBeNull();
    // A due date kept from older data with a time is read on its company day (22:00 UTC on the 4th is the 5th in Muscat).
    expect(spanOf({ startDate: day('2026-11-03'), dueDate: new Date('2026-11-04T22:00:00.000Z') }, TZ)).toEqual({ start: '2026-11-03', due: '2026-11-05', mode: 'bar' });
  });

  it('shown by its span in a range it is not due in: a bar crossing in, a start inside; never a long task passing through', () => {
    const range = { from: '2026-11-08', to: '2026-11-14' };
    // Due in the range: listed with the due tasks already, not again.
    expect(shownBySpan({ startDate: day('2026-11-05'), dueDate: day('2026-11-10') }, range, TZ)).toBe(false);
    // Starts before, due after: the bar crosses the whole week.
    expect(shownBySpan({ startDate: day('2026-11-05'), dueDate: day('2026-11-17') }, range, TZ)).toBe(true);
    // Starts inside, due after.
    expect(shownBySpan({ startDate: day('2026-11-12'), dueDate: day('2026-11-30') }, range, TZ)).toBe(true);
    // Start-only inside.
    expect(shownBySpan({ startDate: day('2026-11-12'), dueDate: null }, range, TZ)).toBe(true);
    // A long task with both marks outside: nothing in this week.
    expect(shownBySpan({ startDate: day('2026-11-01'), dueDate: day('2026-11-30') }, range, TZ)).toBe(false);
    // Entirely before or after.
    expect(shownBySpan({ startDate: day('2026-11-01'), dueDate: day('2026-11-05') }, range, TZ)).toBe(false);
    expect(shownBySpan({ startDate: day('2026-11-15'), dueDate: day('2026-11-20') }, range, TZ)).toBe(false);
    // Due-only outside.
    expect(shownBySpan({ startDate: null, dueDate: day('2026-11-20') }, range, TZ)).toBe(false);
  });
});
