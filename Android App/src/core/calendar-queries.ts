import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { hashKey, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import type { Services } from './services';
import { asyncStore } from '../adapters/async-storage';
import { DATE_PREFERENCES_COPY, DATE_PREFERENCES_KEY, DATE_ZONES_KEY, loadDateSettings } from '../lib/date-settings';
import { dateZones, setDateZones } from '../lib/due-date';
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
export function useCalendarRange(from: string, to: string, enabled = true) {
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
    // Asked for once the week start is known: the days depend on it (5a review).
    enabled,
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
export function useCalendarMeetingsIn(from: string, to: string, timeZone: string, enabled = true) {
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
    enabled,
  });
}

/** Offline, did this phone's copy answer the meetings of these days (it may not hold them all)? */
export function useCalendarMeetingsFromCopy(from: string, to: string, timeZone: string, answered: boolean): boolean {
  const { reads } = useServices();
  const span = meetingRange(from, to, timeZone);
  return answered && reads.answeredFromCopy({ queryHash: hashKey([...CALENDAR_MEETINGS_KEY, span.from, span.to]) });
}

/** Where your date settings are kept (Settings saves into it: core/account-queries). */
export { DATE_PREFERENCES_KEY };

/** Your date settings through their offline copy (one read for the calendar and the load on start). */
const readDatePreferences = (s: Pick<Services, 'resources' | 'reads'>) =>
  s.reads.read(DATE_PREFERENCES_KEY, DATE_PREFERENCES_COPY, () => s.resources.settings.datePreferences());

/** Your date settings (the week start; shared with the website), kept for an offline start. */
export function useDatePreferences() {
  const services = useServices();
  return useQuery({
    queryKey: DATE_PREFERENCES_KEY,
    queryFn: () => readDatePreferences(services),
    staleTime: 5 * 60_000,
  });
}

/**
 * Dates follow the website: the company's time zone everywhere, your own (Settings → Calendar &
 * dates) on the calendar. Loaded once signed in and whenever the app comes back to the front; a
 * load that fails keeps the zones the phone had, and the last ones are kept for the next start.
 * Your settings go where the calendar reads them, so it opens with your week start (5a review).
 */
export function useDateSettingsLoad() {
  const services = useServices();
  useEffect(() => {
    let active = true;
    const load = () =>
      void loadDateSettings({
        qc: services.queryClient,
        config: () => services.resources.settings.config(),
        readPrefs: () => readDatePreferences(services),
        keepZones: (zones) => asyncStore.setItem(DATE_ZONES_KEY, JSON.stringify(zones)),
        zones: { get: dateZones, set: setDateZones },
        isActive: () => active,
      });
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [services]);
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
