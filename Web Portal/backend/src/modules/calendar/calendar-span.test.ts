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

  it('a timed start or due is read on its company day', () => {
    // 22:00 UTC on the 2nd is 02:00 on the 3rd in Muscat.
    expect(spanOf({ startDate: new Date('2026-11-02T22:00:00.000Z'), dueDate: new Date('2026-11-05T09:00:00.000Z') }, TZ)).toEqual({ start: '2026-11-03', due: '2026-11-05', mode: 'bar' });
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
