import { useEffect } from 'react';
import { LayoutAnimation, Platform, UIManager } from 'react-native';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { applyTaskEvent, type TaskEvent } from '../lib/realtime';
import type { ApiTask } from '../lib/types';

// Enable the smooth layout transitions on Android (a no-op elsewhere).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Animate the next commit so cards slide/fade as they move, appear or disappear. */
function animateNext(): void {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

/**
 * Live board updates (A2 / mirrors web M4). Connects to the socket origin with
 * the session token, joins the project room, and folds task events into the
 * cached task list via the tested `applyTaskEvent` reducer. Column changes
 * invalidate the columns query so added/renamed/reordered stages appear live.
 */
export function useBoardRealtime(projectId: string | undefined): void {
  const { baseUrl, session } = useServices();
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;
    const origin = baseUrl.replace(/\/api\/v1\/?$/, '');
    const socket = io(origin, { auth: { token: session.getToken() }, transports: ['websocket'] });
    socket.on('connect', () => socket.emit('join', { projectId }));

    const key = ['tasks', 'project', projectId];
    const fold = (event: TaskEvent) => {
      animateNext();
      qc.setQueryData<ApiTask[]>(key, (prev) => (prev ? applyTaskEvent(prev, event) : prev));
    };
    socket.on('task:created', (payload: ApiTask) => fold({ type: 'task:created', payload }));
    socket.on('task:updated', (payload: ApiTask) => fold({ type: 'task:updated', payload }));
    socket.on('task:moved', (payload: ApiTask) => fold({ type: 'task:moved', payload }));
    // Previously missing — remote deletions now disappear from the board live.
    socket.on('task:deleted', (payload: { id: string }) => fold({ type: 'task:deleted', payload }));
    // A stage was added / renamed / reordered / removed — refresh the columns.
    socket.on('column:changed', () => {
      animateNext();
      void qc.invalidateQueries({ queryKey: ['columns', projectId] });
    });

    return () => {
      socket.disconnect();
    };
    // session is stable for the app's lifetime; reconnect only when the project or origin changes.
  }, [projectId, baseUrl, session, qc]);
}
