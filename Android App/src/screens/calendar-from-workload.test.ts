import { it, expect } from 'vitest';
import { askedCalendarPlace } from '../lib/calendar-screen';
import { DEFAULT_FILTERS } from '../lib/calendar-model';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

/**
 * Stage 3 final review P7: Workload's "Open in Calendar" for someone else opens that person's week
 * on the calendar, as the website's /calendar?view=week&date=<day>&assignee=<id>&done=0&meetings=0
 * (WorkloadPopover.tsx): the week view on that day, their tasks only, open ones, no meetings.
 */
it('the place asked for: that day’s week, the person’s open tasks, no meetings', () => {
  expect(askedCalendarPlace({ week: '2026-10-28', person: 'u2' })).toEqual({
    view: 'week',
    date: '2026-10-28',
    filters: { ...DEFAULT_FILTERS, assigneeId: 'u2', showCompleted: false, showMeetings: false },
  });
  if (hasWeb('frontend/src/components/workload/WorkloadPopover.tsx')) {
    expect(readWeb('frontend/src/components/workload/WorkloadPopover.tsx')).toContain('/calendar?view=week&date=${cell.date}&assignee=${encodeURIComponent(person.id)}&done=0&meetings=0');
  }
});

it('checked first: no real day asks for nothing; a person that isn’t an id filters nobody', () => {
  expect(askedCalendarPlace(undefined)).toBeNull();
  expect(askedCalendarPlace({ person: 'u2' })).toBeNull();
  expect(askedCalendarPlace({ week: '28 Oct', person: 'u2' })).toBeNull();
  expect(askedCalendarPlace({ week: '2026-10-28', person: '../x' })?.filters.assigneeId).toBe('');
});

it('the day sheet passes the day and the person; the calendar takes them as it opens and when they change', () => {
  expect(src('components/workload/DaySheet.tsx')).toMatch(/navigate\('Calendar', \{ week: cell\.date, person: person\.id \}\)/);
  const cal = src('screens/CalendarScreen.tsx');
  expect(cal).toMatch(/askedCalendarPlace\(route\.params\)/);
  expect(src('navigation/types.ts')).toMatch(/Calendar: \{ week\?: string; person\?: string \} \| undefined;/);
});
