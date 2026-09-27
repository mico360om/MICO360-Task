import { useEffect, useRef } from 'react';
import { LayoutAnimation, Platform, UIManager } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { connectAuthedSocket } from './authed-socket';
import { taskEventInvalidationKeys, TASK_EVENTS, PROJECT_REMOVED_EVENT, isProjectRemoval } from '../lib/realtime';

// Enable the smooth layout transitions on Android (a no-op elsewhere).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Animate the next commit so cards slide/fade as they move, appear or disappear. */
function animateNext(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

/**
 * Live board updates (A2 / mirrors web M4, MOB-04, XP-05). Joins the project room and, on every
 * task event, refetches the project's board lists (every board date), the task's detail, "My
 * tasks" and progress — realtime payloads are partial, and the board caches one list per date,
 * so writing the payload into a single cache entry never reached the screen. Column changes
 * refresh the columns. After a reconnect everything is refetched, since events may have been
 * missed while the socket was down. When the server says the user was removed from this project
 * (`project:removed`), `onProjectRemoved` runs so the screen can leave the board.
 */
export function useBoardRealtime(projectId: string | undefined, onProjectRemoved?: () => void): void {
  const services = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  const onRemovedRef = useRef(onProjectRemoved);
  onRemovedRef.current = onProjectRemoved;

  useEffect(() => {
    if (!projectId || !userId) return;
    const refreshAll = () => {
      for (const key of taskEventInvalidationKeys(projectId)) void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['columns', projectId] });
    };

    const { socket, dispose } = connectAuthedSocket(services, (s, isReconnect) => {
      s.emit('join', { projectId });
      if (isReconnect) refreshAll();
    });

    for (const ev of TASK_EVENTS) {
      socket.on(ev, (payload: { id?: unknown } | undefined) => {
        animateNext();
        for (const key of taskEventInvalidationKeys(projectId, payload)) void qc.invalidateQueries({ queryKey: key });
      });
    }
    // A stage was added / renamed / reordered / removed — refresh the columns.
    socket.on('column:changed', () => {
      animateNext();
      void qc.invalidateQueries({ queryKey: ['columns', projectId] });
    });
    // The user lost access to this project: refresh the project list and leave the board.
    socket.on(PROJECT_REMOVED_EVENT, (payload: unknown) => {
      if (!isProjectRemoval(payload, projectId)) return;
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onRemovedRef.current?.();
    });

    return dispose;
    // Reconnect only when the project, the signed-in user or the services change.
  }, [projectId, userId, services, qc]);
}
