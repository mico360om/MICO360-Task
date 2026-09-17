import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../stores/auth-store';

/** Socket origin (without the /api/v1 prefix). */
const SOCKET_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');
const TASK_EVENTS = ['task:created', 'task:updated', 'task:moved'] as const;

/**
 * Subscribe to live task events for a project's board (M4 / T7.4). Calls
 * `onTaskEvent` whenever another client creates/updates/moves a task so the
 * board can refetch. Reconnects only when the project changes.
 */
export function useBoardRealtime(projectId: string | undefined, onTaskEvent: () => void): void {
  const cb = useRef(onTaskEvent);
  cb.current = onTaskEvent;

  useEffect(() => {
    if (!projectId) return;
    const token = useAuthStore.getState().accessToken;
    const socket = io(SOCKET_URL, { auth: { token } });
    socket.on('connect', () => socket.emit('join', { projectId }));
    for (const ev of TASK_EVENTS) socket.on(ev, () => cb.current());
    return () => {
      socket.disconnect();
    };
  }, [projectId]);
}
