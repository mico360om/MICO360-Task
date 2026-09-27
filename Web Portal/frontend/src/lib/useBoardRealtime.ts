import { useEffect, useRef } from 'react';
import { openAuthedSocket } from './authedSocket';

/**
 * Every event the board reacts to: task events broadcast to the project room, `project:removed`
 * (sent to a user taken off a project), plus our own post-reconnect `resync`.
 */
export const TASK_EVENTS = ['task:created', 'task:updated', 'task:moved', 'task:deleted', 'task:assignees', 'project:removed', 'resync'] as const;
export type BoardEvent = (typeof TASK_EVENTS)[number];

/**
 * Subscribe to live task events for a project's board (M4 / T7.4). Calls `onTaskEvent(event, payload)`
 * whenever another client creates, updates, moves, deletes or reassigns a task, so the board can
 * refetch. Token refresh, reconnecting after the server closes the socket, and signing out a revoked
 * session are handled by openAuthedSocket. After any reconnect the room is re-joined and the board is
 * told to `resync` — events may have been missed while disconnected. Reconnects only when the project
 * changes.
 */
export function useBoardRealtime(projectId: string | undefined, onTaskEvent: (event: BoardEvent, payload?: unknown) => void): void {
  const cb = useRef(onTaskEvent);
  cb.current = onTaskEvent;

  useEffect(() => {
    if (!projectId) return;
    const { socket, close } = openAuthedSocket({
      onConnect: (s, isReconnect) => {
        s.emit('join', { projectId });
        if (isReconnect) cb.current('resync');
      },
    });
    for (const ev of TASK_EVENTS) {
      if (ev === 'resync') continue;
      socket.on(ev, (payload?: unknown) => cb.current(ev, payload));
    }
    return close;
  }, [projectId]);
}
