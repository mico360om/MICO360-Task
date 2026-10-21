import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';
import { refresh, type Refresh } from './refresh';
import type { ApiMeeting, ApiMeetingAttendee, SeriesScope } from './types';

/**
 * What the app keeps of a meeting after it changes it (2a, 2b): which cached parts are put right
 * at once, and which are loaded again — only what is on screen is fetched (refresh). The server
 * also announces each change (`meeting:*`), which refreshes the part for everyone else.
 */

/** The meeting lists (the Meetings tab's, the calendar's). */
const LISTS: Refresh = { queryKey: ['meetings'] };
/** Only a count on the lists' cards changed: fetched when the list is next shown. */
const LIST_COUNTS: Refresh = { queryKey: ['meetings'], later: true };
const MY_ITEMS: Refresh = { queryKey: ['action-items', 'mine'] };

export type MeetingPart = 'attendees' | 'agenda' | 'notes' | 'action-items' | 'final-minutes';

/**
 * A row the server answered with, put into a part's cached list at once: it replaces the row with
 * its id, or is added at the end. A list not loaded yet is left alone (it is fetched as it is).
 */
export function putRow<T extends { id: string }>(qc: QueryClient, key: readonly unknown[], row: T): void {
  qc.setQueryData<T[]>(key, (list) => {
    if (!list) return list;
    return list.some((r) => r.id === row.id) ? list.map((r) => (r.id === row.id ? row : r)) : [...list, row];
  });
}

/**
 * A change shown before the server answers (an agenda tick, an action item's status, attendance):
 * the row with its id patched in the cached list. Returns the row as it was (to put back if the
 * server refuses), or null when the list doesn't hold it.
 */
export function patchRow<T extends { id: string }>(qc: QueryClient, key: readonly unknown[], id: string, patch: Partial<T>): T | null {
  const before = qc.getQueryData<T[]>(key)?.find((r) => r.id === id) ?? null;
  if (before) qc.setQueryData<T[]>(key, (list) => list?.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return before;
}

/** A removed row taken out of a part's cached list at once. */
export function dropRow(qc: QueryClient, key: readonly unknown[], id: string): void {
  qc.setQueryData<{ id: string }[]>(key, (list) => list?.filter((r) => r.id !== id));
}

/**
 * After my change to one part of a meeting (shown at once from the server's answer): what else
 * shows it goes out of date — the lists' cards and the project's meetings (fetched when next
 * shown), and My Action Items for an action item.
 */
export function afterPartChanged(qc: QueryClient, meetingId: string, part: MeetingPart): void {
  const targets: Refresh[] = [LIST_COUNTS, { projectMeetingsOf: meetingId }];
  if (part === 'action-items') targets.push(MY_ITEMS);
  refresh(qc, targets);
}

/** A create's reply without its people and agenda rows — which go into the meeting's own lists. */
function withoutPartLists(qc: QueryClient, reply: ApiMeeting): ApiMeeting {
  const { attendees, agendaItems, ...meeting } = reply as Omit<ApiMeeting, 'attendees'> & { attendees?: unknown[]; agendaItems?: unknown[] };
  const rows = Array.isArray(attendees) && attendees.some((a) => typeof a === 'object' && a !== null);
  if (!rows && !Array.isArray(agendaItems)) return reply;
  if (rows) qc.setQueryData(['meeting', reply.id, 'attendees'], attendees);
  if (Array.isArray(agendaItems)) qc.setQueryData(['meeting', reply.id, 'agenda'], agendaItems);
  return (rows ? meeting : { ...meeting, attendees }) as ApiMeeting;
}

/**
 * A meeting saved (the form, a status change, cancelling, a new one or a copy): shown at once —
 * keeping what only its own read gives (its series, `canEdit`) — and the lists, its project's
 * meetings and My Action Items (which name it) load again. A change to a whole series puts every
 * meeting's details out of date (fetched when next shown).
 */
export function afterMeetingSaved(qc: QueryClient, reply: ApiMeeting, opts: { scope?: SeriesScope; editedId?: string }): void {
  // A new meeting saved with its people and agenda (2c) comes back with both lists: its screen opens
  // with them, and the meeting keeps only its own fields (a list card's `attendees` are names).
  const saved = withoutPartLists(qc, reply);
  // Moved to another project: the old project's meetings change too (read before the new copy goes in).
  const oldProject = qc.getQueryData<ApiMeeting>(['meeting', saved.id])?.projectId;
  qc.setQueryData<ApiMeeting>(['meeting', saved.id], (old) => (old ? { ...old, ...saved } : saved));
  const targets: Refresh[] = [LISTS, { projectMeetingsOf: saved.id }, { ...MY_ITEMS, later: true }];
  if (oldProject && oldProject !== saved.projectId) targets.push({ queryKey: ['project', oldProject, 'meetings'], exact: true });
  if (opts.scope === 'series') {
    targets.push({ queryKey: ['meeting'], later: true });
    // The server may answer with the series' next meeting (the new schedule had no place for the one
    // edited): the edited one is loaded again now, so its screen shows what became of it.
    if (opts.editedId && opts.editedId !== saved.id) targets.push({ queryKey: ['meeting', opts.editedId], exact: true });
  }
  refresh(qc, targets);
}

/**
 * A meeting deleted (or the upcoming meetings of its series): the lists, its project's meetings and
 * My Action Items load again — worked out before its data goes, while the cache still knows its
 * project — then everything of it is dropped. Call it once its screen is closed.
 */
export function afterMeetingDeleted(qc: QueryClient, meetingId: string, scope: SeriesScope): void {
  const targets: Refresh[] = [LISTS, { projectMeetingsOf: meetingId }, MY_ITEMS];
  if (scope === 'series') targets.push({ queryKey: ['meeting'], later: true });
  refresh(qc, targets);
  qc.removeQueries({ queryKey: ['meeting', meetingId] });
}

/**
 * A task made from a meeting note: its board, My Tasks (when it is mine), its project's progress
 * and the calendar's ranges (5a) — marked out of date and fetched when next shown.
 */
export function noteTaskRefreshes(projectId: string): Refresh[] {
  return [
    { queryKey: ['tasks', 'project', projectId], later: true },
    { queryKey: ['tasks', 'mine'], later: true },
    { queryKey: ['project', projectId, 'progress'], later: true },
    { queryKey: ['tasks', 'calendar'], later: true },
  ];
}

/**
 * One meeting's answers to the invitation go one after another (TanStack's mutation scope): a quick
 * second tap waits for the first instead of racing it, so the last tap is the answer kept.
 */
export function answerScope(meetingId: string): { id: string } {
  return { id: `rsvp:${meetingId}` };
}

/** 403: no longer yours to see; 404: gone. The meeting itself is then loaded again, and the screen says so. */
export function isGoneOrNotMine(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

/**
 * My answer was refused, or got no answer. My row's old answer goes back into whatever list is
 * there now — a newer list that arrived while the answer was on its way keeps everyone else's
 * rows — and the people are loaded again, so the screen shows what the server holds. A meeting that
 * is gone or no longer mine is loaded again too, so the screen says so.
 */
export function answerFailed(qc: QueryClient, f: { meetingId: string; previous: ApiMeetingAttendee | null; error: unknown }): void {
  const key = ['meeting', f.meetingId, 'attendees'];
  const previous = f.previous;
  if (previous) {
    qc.setQueryData<ApiMeetingAttendee[]>(key, (list) =>
      list?.map((a) => (a.id === previous.id ? { ...a, response: previous.response, respondedAt: previous.respondedAt ?? null } : a)),
    );
  }
  const targets: Refresh[] = [{ queryKey: key, exact: true }];
  if (isGoneOrNotMine(f.error)) targets.push({ queryKey: ['meeting', f.meetingId], exact: true });
  refresh(qc, targets);
}
