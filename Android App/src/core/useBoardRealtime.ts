import { useEffect, useRef } from 'react';
import { LayoutAnimation, Platform, UIManager } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { connectAuthedSocket } from './authed-socket';
import {
  afterRemoval,
  boardRefreshes,
  createJoinMemory,
  isProjectRemoval,
  PROJECT_REMOVED_EVENT,
  taskEventRefreshes,
  taskPartRefreshes,
  TASK_EVENTS,
  TASK_PART_EVENTS,
} from '../lib/realtime';
import { refresh } from '../lib/refresh';
import { createRefreshBatcher } from '../lib/refresh-batch';
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
 * Live board updates (A2 / mirrors web M4, MOB-04, XP-05). Joins the project room and, on every
 * task event, refetches the project's board (the day on screen), the other lists holding the task,
 * its details and activity, and progress (taskEventRefreshes) — realtime payloads are partial, and
 * the board caches one list per date, so writing the payload into a single cache entry never
 * reached the screen. A change to one part of a task (assignees, tags, watchers, checklist,
 * comments) refreshes only that part. Column changes refresh the columns. Events are gathered for
 * about 300 ms and refreshed in one pass, with one animation (a carry-forward or a bulk move sends
 * dozens). After a reconnect the board is refetched, since events may have been missed while the
 * socket was down — and when the screen comes back after it stopped listening (a task opened over
 * it): it missed what happened meanwhile (5b review). When the server says the user was removed
 * from this project (`project:removed`), the project is read again: `onProjectRemoved` runs (the
 * screen leaves) only when it can't be opened any more; someone who still sees it (an
 * administrator) stays, listening again.
 */
export function useBoardRealtime(projectId: string | undefined, onProjectRemoved?: () => void): void {
  const services = useServices();
  const userId = useUserId();
  const qc = useQueryClient();
  const onRemovedRef = useRef(onProjectRemoved);
  onRemovedRef.current = onProjectRemoved;
  // Projects this screen listened to before: coming back to one refreshes it (5b review).
  const joins = useRef(createJoinMemory()).current;

  useEffect(() => {
    if (!projectId || !userId) return;
    // Cards move, appear or disappear only for task and column events, not for a task's parts.
    let animate = false;
    const batch = createRefreshBatcher((targets) => {
      if (animate) animateNext();
      animate = false;
      refresh(qc, targets);
    });
    const later = (targets: Parameters<typeof batch.add>[0], moveCards = false) => {
      if (moveCards) animate = true;
      batch.add(targets);
    };

    let first = true;
    const { socket, dispose } = connectAuthedSocket(services, (s, isReconnect) => {
      s.emit('join', { projectId });
      const back = first && joins.returning(projectId);
      first = false;
      if (isReconnect || back) later(boardRefreshes(projectId));
    });

    for (const ev of TASK_EVENTS) {
      socket.on(ev, (payload: unknown) => later(taskEventRefreshes(ev, projectId, payload), true));
    }
    // One part of a task changed (people, tags, followers, checklist, comments): refresh just that
    // part of that task — the task details open over the board pick it up; the cards don't change.
    for (const ev of TASK_PART_EVENTS) {
      socket.on(ev, (payload: unknown) => {
        const taskId = (payload as { taskId?: unknown } | null)?.taskId;
        const inMyTasks = (qc.getQueryData<ApiTask[]>(['tasks', 'mine']) ?? []).some((t) => t.id === taskId);
        later(taskPartRefreshes(ev, payload, { myId: userId, inMyTasks }));
      });
    }
    // A stage was added / renamed / reordered / removed — refresh the columns.
    socket.on('column:changed', () => later([{ queryKey: ['columns', projectId] }], true));
    // The user lost access to this project: refresh the project list and leave the board.
    socket.on(PROJECT_REMOVED_EVENT, (payload: unknown) => {
      if (!isProjectRemoval(payload, projectId)) return;
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void afterRemoval(() => services.resources.projects.get(projectId)).then((outcome) => {
        if (outcome === 'gone') onRemovedRef.current?.();
        else if (outcome === 'still-allowed' && socket.connected) {
          // Still allowed (an administrator): back in the project's room, and up to date.
          socket.emit('join', { projectId });
          later(boardRefreshes(projectId));
          void qc.invalidateQueries({ queryKey: ['project', projectId] });
        }
      });
    });

    return () => {
      dispose();
      // What arrived just before the board closed still reaches the screens below it (unanimated).
      animate = false;
      batch.flush();
    };
    // Reconnect only when the project, the signed-in user or the services change.
  }, [projectId, userId, services, qc, joins]);
}
