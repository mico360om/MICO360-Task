import { useEffect, useRef } from 'react';
import { openAuthedSocket } from '../../lib/authedSocket';
import { TASK_EVENTS } from '../../lib/useBoardRealtime';

/** What changes someone's priorities in a project's room: task events, 1.23.3 checklist changes, inspections. */
export const PRIORITY_EVENTS = [...TASK_EVENTS.filter((e) => e !== 'resync'), 'checklist:changed', 'inspection:changed'] as const;

/**
 * 1.23.4 "My Priorities Today" live: one connection that joins the rooms of the projects on the list and
 * calls `onChange` for each change there (and after a reconnect, when events may have been missed).
 * Keyed by the ids themselves, so a new list naming the same projects doesn't reconnect.
 */
export function usePrioritiesRealtime(projectIds: readonly string[] | undefined, onChange: () => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const roomKey = [...(projectIds ?? [])].sort().join(',');
  useEffect(() => {
    if (!roomKey) return;
    const ids = roomKey.split(',');
    const { socket, close } = openAuthedSocket({
      onConnect: (s, isReconnect) => {
        for (const projectId of ids) s.emit('join', { projectId });
        if (isReconnect) cb.current();
      },
    });
    for (const ev of PRIORITY_EVENTS) socket.on(ev, () => cb.current());
    return close;
  }, [roomKey]);
}
