import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { openAuthedSocket } from './authedSocket';
import { TASK_EVENTS } from './useBoardRealtime';

/** What changed in a project: its tasks, its meetings, its inspections, everything (after a reconnect), or your access. */
export type ProjectChange = 'tasks' | 'meetings' | 'inspections' | 'all' | 'removed';

/** Every meeting event the server sends to a project's room. */
export const PROJECT_MEETING_EVENTS = [
  'meeting:created',
  'meeting:updated',
  'meeting:cancelled',
  'meeting:deleted',
  'meeting:notes',
  'meeting:agenda',
  'meeting:attendees',
  'meeting:action-items',
] as const;

/**
 * Live updates for a project's dashboard: joins the project's room and reports whether its tasks,
 * its meetings or one of its inspections (with its id) changed (so the dashboard refetches just
 * that), `all` after a reconnect (events may have been missed) and `removed` when the signed-in
 * person is taken off the project.
 * `live` says whether the connection is up.
 */
export function useProjectRealtime(projectId: string | undefined, onChange: (change: ProjectChange, payload?: { id?: string }) => void): { live: boolean } {
  const cb = useRef(onChange);
  cb.current = onChange;
  const signedIn = useAuthStore((s) => Boolean(s.accessToken));
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!signedIn || !projectId) return;
    const { socket, close } = openAuthedSocket({
      onConnect: (s, isReconnect) => {
        s.emit('join', { projectId });
        setLive(true);
        if (isReconnect) cb.current('all');
      },
      onDisconnect: () => setLive(false),
    });
    for (const ev of TASK_EVENTS) {
      if (ev === 'resync') continue;
      socket.on(ev, () => cb.current(ev === 'project:removed' ? 'removed' : 'tasks'));
    }
    for (const ev of PROJECT_MEETING_EVENTS) socket.on(ev, () => cb.current('meetings'));
    // Which inspection, so an open one refreshes only for itself.
    socket.on('inspection:changed', (p?: { id?: unknown }) => cb.current('inspections', typeof p?.id === 'string' ? { id: p.id } : undefined));
    return () => {
      setLive(false);
      close();
    };
  }, [projectId, signedIn]);

  return { live };
}
