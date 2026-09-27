import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { openAuthedSocket } from './authedSocket';

/** Which part of a meeting changed, derived from the server's `meeting:*` socket events. */
export type MeetingChangeKind = 'meeting' | 'notes' | 'agenda' | 'attendees' | 'action-items' | 'reconnect';

const EVENT_KIND: Record<string, MeetingChangeKind> = {
  'meeting:updated': 'meeting',
  'meeting:cancelled': 'meeting',
  'meeting:notes': 'notes',
  'meeting:agenda': 'agenda',
  'meeting:attendees': 'attendees',
  'meeting:action-items': 'action-items',
};

/**
 * Live updates for one meeting. The server broadcasts `meeting:*` events (with `{ id }`) to the
 * meeting's project room, so this joins that room and calls `onChange` with the part of the
 * meeting that changed. Standalone meetings have no room; callers poll those instead.
 * After a reconnect `onChange('reconnect')` fires so everything can be refetched.
 */
export function useMeetingRealtime(
  meetingId: string | undefined,
  projectId: string | null | undefined,
  onChange: (kind: MeetingChangeKind) => void,
): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const signedIn = useAuthStore((s) => Boolean(s.accessToken));

  useEffect(() => {
    if (!signedIn || !meetingId || !projectId) return;
    const { socket, close } = openAuthedSocket({
      onConnect: (s, isReconnect) => {
        s.emit('join', { projectId });
        if (isReconnect) cb.current('reconnect');
      },
    });
    for (const [event, kind] of Object.entries(EVENT_KIND)) {
      socket.on(event, (payload: { id?: string } | undefined) => {
        if (payload?.id && payload.id !== meetingId) return; // another meeting in the same project
        cb.current(kind);
      });
    }
    return close;
  }, [meetingId, projectId, signedIn]);
}
