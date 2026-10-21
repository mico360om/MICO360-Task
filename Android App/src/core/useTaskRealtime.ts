import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { connectAuthedSocket } from './authed-socket';
import { afterRemoval, createJoinMemory } from '../lib/realtime';
import { refresh } from '../lib/refresh';
import { createRefreshBatcher } from '../lib/refresh-batch';
import { followTask, taskDetailCatchUp } from '../lib/task-realtime';
import type { ApiTask } from '../lib/types';

/**
 * Task details, live (4d): joins the task's project room while `taskId` is given (the screen passes
 * it only while it is in view) and follows the task (lib/task-realtime followTask). Events are
 * gathered for about 300 ms and refreshed in one pass. After a reconnect — and the first connection
 * when the screen comes back (it stopped listening while something was over it) — the task and all
 * its parts are fetched again. Taken off the project: the task is read again, and `onRemoved` runs
 * only when it can't be opened any more (an administrator stays, listening again). Everything it
 * listened to is let go when it stops.
 */
export function useTaskRealtime(
  taskId: string | undefined,
  projectId: string | undefined,
  handlers: { linkedIds: readonly string[]; onDeleted: () => void; onRemoved: () => void },
): void {
  const services = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  const latest = useRef(handlers);
  latest.current = handlers;
  const joins = useRef(createJoinMemory()).current;

  useEffect(() => {
    if (!taskId || !projectId || !userId) return;
    const batch = createRefreshBatcher((targets) => refresh(qc, targets));
    let first = true;
    const { socket, dispose } = connectAuthedSocket(services, (s, isReconnect) => {
      s.emit('join', { projectId });
      const back = first && joins.returning(taskId);
      first = false;
      if (isReconnect || back) batch.add(taskDetailCatchUp(taskId));
    });
    const stop = followTask(socket, {
      taskId,
      projectId,
      linked: () => new Set(latest.current.linkedIds),
      myId: userId,
      inMyTasks: () => (qc.getQueryData<ApiTask[]>(['tasks', 'mine']) ?? []).some((t) => t.id === taskId),
      add: (targets) => batch.add(targets),
      onDeleted: () => latest.current.onDeleted(),
      onRemoval: () => {
        void afterRemoval(() => services.resources.tasks.get(taskId)).then((outcome) => {
          if (outcome === 'gone') latest.current.onRemoved();
          else if (outcome === 'still-allowed' && socket.connected) {
            socket.emit('join', { projectId });
            batch.add(taskDetailCatchUp(taskId));
          }
        });
      },
    });

    return () => {
      stop();
      dispose();
      // What arrived just before the screen let go still reaches it.
      batch.flush();
    };
  }, [taskId, projectId, userId, services, qc, joins]);
}
