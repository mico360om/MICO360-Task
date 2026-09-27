/**
 * Who hears a meeting's live events (`meeting:updated`, `meeting:notes`, …). A project meeting
 * reaches its project's room; every meeting — standalone ones included, which have no project
 * room — also reaches its organizer, creator and internal attendees directly. The realtime layer
 * emits once per socket across these rooms, so nobody refetches twice.
 */

export interface MeetingAudienceFacts {
  projectId: string | null;
  organizerId: string;
  createdById: string;
  /** Internal attendees (external guests have no account). */
  attendeeUserIds: string[];
}

export interface MeetingEventAudience {
  projectId: string | null;
  userIds: string[];
}

export function meetingEventAudience(facts: MeetingAudienceFacts): MeetingEventAudience {
  return { projectId: facts.projectId, userIds: [...new Set([facts.organizerId, facts.createdById, ...facts.attendeeUserIds])] };
}

export interface MeetingEventsDeps {
  /** The meeting's audience facts — including soft-deleted meetings, so deletions are announced too. */
  loadAudience(meetingId: string): Promise<MeetingAudienceFacts | null>;
  emit(audience: MeetingEventAudience, event: string, payload: { id: string }): void;
  onError?: (err: unknown) => void;
}

export function createMeetingEvents(deps: MeetingEventsDeps) {
  /** Announce a meeting change (fire-and-forget: it never slows or fails the request). */
  function publish(meetingId: string, event: string): Promise<void> {
    return deps
      .loadAudience(meetingId)
      .then((facts) => {
        if (facts) deps.emit(meetingEventAudience(facts), event, { id: meetingId });
      })
      .catch((err) => deps.onError?.(err));
  }
  return { publish };
}

export type MeetingEvents = ReturnType<typeof createMeetingEvents>;
