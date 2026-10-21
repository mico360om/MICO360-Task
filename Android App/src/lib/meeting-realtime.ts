import type { Refresh } from './refresh';

/**
 * Live meeting events. The server sends `meeting:*` (with the meeting's `{ id }`) to the meeting's
 * project room and to its organizer, creator and attendees' own rooms (Web Portal/backend
 * meeting-events.ts), so the app's one signed-in socket — in the user's room and every project
 * room — hears every meeting the user can see. Each event refreshes what it changed; only what is
 * on screen is fetched again (refresh), and events are gathered into one pass (refresh-batch).
 */
export const MEETING_EVENTS = [
  'meeting:created',
  'meeting:updated',
  'meeting:cancelled',
  'meeting:deleted',
  'meeting:attendees',
  'meeting:agenda',
  'meeting:notes',
  'meeting:action-items',
] as const;

/** The Meetings tab's lists and the calendar's meetings. */
const LISTS: Refresh = { queryKey: ['meetings'] };
const MY_ITEMS: Refresh = { queryKey: ['action-items', 'mine'] };

/** After a reconnect (events may have been missed): everything about meetings. */
export function meetingsReconnectRefreshes(): Refresh[] {
  return [LISTS, { queryKey: ['meeting'] }, MY_ITEMS, { projectMeetingsOf: '' }];
}

/**
 * What a meeting event refreshes: the part of that meeting it names, plus the list cards where the
 * part shows on them (people, minutes and decisions, open action items) and its project's meetings.
 * The agenda shows only on the meeting itself.
 */
export function meetingEventRefreshes(event: string, payload: unknown): Refresh[] {
  if (!(MEETING_EVENTS as readonly string[]).includes(event)) return [];
  const raw = (payload as { id?: unknown } | null | undefined)?.id;
  if (typeof raw !== 'string' || !raw) return meetingsReconnectRefreshes();
  const id = raw;
  const part = (name?: string): Refresh => ({ queryKey: name ? ['meeting', id, name] : ['meeting', id], exact: true });
  const project: Refresh = { projectMeetingsOf: id };
  switch (event) {
    case 'meeting:created':
      return [LISTS, project];
    case 'meeting:updated':
    case 'meeting:cancelled':
      return [LISTS, part(), project];
    case 'meeting:deleted':
      return [LISTS, { queryKey: ['meeting', id] }, project, MY_ITEMS];
    case 'meeting:agenda':
      return [part('agenda')];
    case 'meeting:attendees':
      return [LISTS, part('attendees'), project];
    case 'meeting:notes':
      return [LISTS, part('notes'), project];
    case 'meeting:action-items':
      return [LISTS, part('action-items'), MY_ITEMS, project];
    default:
      return [];
  }
}
