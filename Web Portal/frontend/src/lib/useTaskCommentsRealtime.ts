import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { openAuthedSocket } from './authedSocket';

/** The comment events the server sends to a project's room (comment-routes.ts and the Client portal's comments). */
export const COMMENT_EVENTS = ['comment:created', 'comment:updated', 'comment:deleted'] as const;

const taskIdOf = (payload: unknown, key: 'taskId' | 'id'): string | null => {
  const v = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : null;
  return typeof v === 'string' ? v : null;
};

/**
 * Comments, newest first: live comments for an open task panel: joins the task's project room (the same room and rule as the
 * board — only people who may see the project's tasks) and calls `onChange` when a comment on THIS task is
 * added, changed or deleted, when the task itself changes (a send-back's reason is a comment), and after a
 * reconnect (events may have been missed). The caller reads the comments again, so what shows always comes
 * through the comments' own permission checks.
 */
export function useTaskCommentsRealtime(projectId: string | undefined, taskId: string, onChange: () => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const signedIn = useAuthStore((s) => Boolean(s.accessToken));

  useEffect(() => {
    if (!signedIn || !projectId || !taskId) return;
    const { socket, close } = openAuthedSocket({
      onConnect: (s, isReconnect) => {
        s.emit('join', { projectId });
        if (isReconnect) cb.current();
      },
    });
    for (const ev of COMMENT_EVENTS) {
      socket.on(ev, (payload?: unknown) => {
        if (taskIdOf(payload, 'taskId') === taskId) cb.current();
      });
    }
    socket.on('task:updated', (payload?: unknown) => {
      if (taskIdOf(payload, 'id') === taskId) cb.current();
    });
    return close;
  }, [projectId, taskId, signedIn]);
}
