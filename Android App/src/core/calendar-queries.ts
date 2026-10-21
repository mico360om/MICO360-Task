import { useMemo } from 'react';
import { hashKey, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { listWithPendingDueDates, meetingsInRange, rangeView, slimRange } from '../lib/calendar-data';
import { meetingRange } from '../lib/calendar-meetings';
import { CALENDAR_KEY, rescheduleOptions } from '../lib/calendar-move';

/**
 * The calendar's reads and its one write (5a). Its ranges and overdue list live under
 * ['tasks', 'calendar'] — task lists the app's refreshes already reach (a saved edit, a live event
 * or a replayed change refreshes the ranges holding the task; a new task refreshes them all) — and
 * its meetings under ['meetings', 'calendar'], which every meeting change refreshes.
 *
 * Each read keeps an offline copy of the last one seen (one per kind, so the copies stay small);
 * offline, a range shows what that copy has of its days, and says so.
 */
export { CALENDAR_KEY };
export const calendarRangeKey = (from: string, to: string) => [...CALENDAR_KEY, from, to];
export const CALENDAR_OVERDUE_KEY = [...CALENDAR_KEY, 'overdue'];
export const CALENDAR_MEETINGS_KEY = ['meetings', 'calendar'] as const;

/** One range of days: everyone's tasks due in it (projects you can see) and the repeats to come. */
export function useCalendarRange(from: string, to: string) {
  const { resources, reads, queue, currentUserId } = useServices();
  return useQuery({
    queryKey: calendarRangeKey(from, to),
    queryFn: async ({ queryKey }) => {
      const answer = await reads.read(queryKey, 'calendar.last', () => resources.calendar.range(from, to), { slim: slimRange(Date.now()) });
      const fromCopy = reads.answeredFromCopy({ queryHash: hashKey(queryKey) });
      return rangeView(answer, from, to, { fromCopy, pending: queue.pendingFor(currentUserId()) });
    },
    // The days you leave stay on screen (dimmed) until the next ones arrive.
    placeholderData: keepPreviousData,
  });
}

/** The tasks already past their day (the agenda's first section), with the moves still waiting. */
export function useCalendarOverdue(enabled: boolean) {
  const { resources, reads, queue, currentUserId } = useServices();
  return useQuery({
    queryKey: CALENDAR_OVERDUE_KEY,
    queryFn: async ({ queryKey }) =>
      listWithPendingDueDates(await reads.read(queryKey, 'calendar.overdue', () => resources.calendar.overdue()), queue.pendingFor(currentUserId())),
    enabled,
  });
}

/** The meetings in the visible days (the calendar's time zone). */
export function useCalendarMeetingsIn(from: string, to: string, timeZone: string) {
  const { resources, reads } = useServices();
  const span = meetingRange(from, to, timeZone);
  return useQuery({
    queryKey: [...CALENDAR_MEETINGS_KEY, span.from, span.to],
    queryFn: async ({ queryKey }) => {
      const list = await reads.read(queryKey, 'meetings.calendar', () => resources.meetings.range(span.from, span.to));
      // Offline, the copy may be of other days: only the ones asked for are shown.
      return reads.answeredFromCopy({ queryHash: hashKey(queryKey) }) ? meetingsInRange(list, span.from, span.to) : list;
    },
    placeholderData: keepPreviousData,
  });
}

/** Where your date settings are kept (Settings saves into it: core/account-queries). */
export const DATE_PREFERENCES_KEY = ['settings', 'date-preferences'];

/** Your date settings (the week start; shared with the website), kept for an offline start. */
export function useDatePreferences() {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: DATE_PREFERENCES_KEY,
    queryFn: ({ queryKey }) => reads.read(queryKey, 'date-preferences', () => resources.settings.datePreferences()),
    staleTime: 5 * 60_000,
  });
}

/** Move a task to another day, through the app's task-edit path (lib/calendar-move). */
export function useRescheduleTask() {
  const { resources, queue, currentUserId, sync } = useServices();
  const qc = useQueryClient();
  const options = useMemo(
    () => rescheduleOptions({ update: (id, body) => resources.tasks.update(id, body), queue, userId: currentUserId, sync: () => void sync.trigger() }, qc),
    [resources, queue, currentUserId, sync, qc],
  );
  return useMutation(options);
}
