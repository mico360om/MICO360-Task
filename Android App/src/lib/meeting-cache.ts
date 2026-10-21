import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';
import { refresh, type Refresh } from './refresh';
import type { ApiMeetingAttendee } from './types';

/**
 * What the app keeps of a meeting after it changes it (2a, 2b): which cached parts are put right
 * at once, and which are loaded again — only what is on screen is fetched (refresh).
 */

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
